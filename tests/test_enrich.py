import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import daily, digest
from src.ai import enrich
from src import store as job_store


def facts(**overrides):
    data = {'languages': [], 'english_is_enough': {'value': 'unknown', 'evidence': ''},
            'seniority': {'value': 'unknown', 'evidence': ''},
            'work_mode': {'value': 'unknown', 'remote_scope': '', 'evidence': ''}, 'workload': 'unknown',
            'salary': {'stated': False, 'text': ''}, 'employer_type': {'value': 'unknown', 'evidence': ''},
            'role_family': 'sre', 'technologies': [], 'on_call': 'unknown', 'confidence': 'high'}
    data.update(overrides)
    return data


class FakeClient:
    """Stands in for anthropic.Anthropic; records requests and returns canned JSON."""
    def __init__(self, data):
        self.data, self.requests = data, []
        self.messages = self

    def create(self, **params):
        self.requests.append(params)
        return SimpleNamespace(stop_reason='end_turn',
                               content=[SimpleNamespace(type='text', text=json.dumps(self.data))],
                               usage=SimpleNamespace(input_tokens=10, output_tokens=5))


def seed(db, jobs):
    job_store.import_watch_report(db, {'jobs': [
        dict({'company': 'Example', 'location': 'Zurich', 'description': 'Kubernetes and Terraform.'},
             id=str(i), url=f'https://x.test/{i}', **job) for i, job in enumerate(jobs)]})


class EnrichTests(unittest.TestCase):
    def test_only_new_or_changed_descriptions_are_pending(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed(db, [{'title': 'SRE'}, {'title': 'No text', 'description': ''}])
                pending = enrich.pending_jobs(db, 10)
                self.assertEqual([j['title'] for j in pending], ['SRE'])
                data, _ = enrich.extract(FakeClient(facts()), 'claude-opus-5', pending[0])
                enrich.save(db, pending[0], 'claude-opus-5', data)
                self.assertEqual(enrich.pending_jobs(db, 10), [])
                seed(db, [{'title': 'SRE', 'description': 'Now also on-call.'}])
                self.assertEqual(len(enrich.pending_jobs(db, 10)), 1)

    def test_run_enriches_all_pending_jobs_in_parallel(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed(db, [{'title': f'SRE {i}'} for i in range(12)])
                client = FakeClient(facts())
                summary = enrich.run(db, 'claude-haiku-4-5', 50, client=client, workers=4)
                self.assertIn('Enriched 12 of 12', summary)
                self.assertEqual(len(client.requests), 12)
                self.assertEqual(len(enrich.load(db)), 12)
                self.assertEqual(enrich.pending_jobs(db, 50), [])

    def test_request_uses_json_schema_and_effort_only_where_supported(self):
        job = {'title': 'SRE', 'company': 'Example', 'location': 'Zurich', 'description': 'text'}
        client = FakeClient(facts())
        enrich.extract(client, 'claude-opus-5', job)
        enrich.extract(client, 'claude-haiku-4-5', job)
        self.assertEqual(client.requests[0]['output_config']['format']['type'], 'json_schema')
        self.assertEqual(client.requests[0]['output_config']['effort'], 'low')
        self.assertNotIn('effort', client.requests[1]['output_config'])

    def test_required_german_is_hidden_and_badges_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                seed(db, [{'title': 'SRE German'}, {'title': 'SRE English'}])
                english, german = sorted(enrich.pending_jobs(db, 10), key=lambda j: j['title'])
                enrich.save(db, german, 'm', facts(languages=[
                    {'language': 'German', 'level': 'required', 'evidence': 'fliessend Deutsch'}]))
                enrich.save(db, english, 'm', facts(
                    english_is_enough={'value': 'yes', 'evidence': 'English is our working language'},
                    seniority={'value': 'senior', 'evidence': 'Senior'},
                    languages=[{'language': 'French', 'level': 'nice_to_have', 'evidence': 'French is a plus'}],
                    salary={'stated': True, 'text': 'CHF 130k–150k'}))
                message = digest.format_digest(db)
        self.assertNotIn('SRE German', message)
        self.assertIn('1 filtered', message)
        for badge in ('🇬🇧 English', '<b>Senior</b>', '🇫🇷 French +', '💰 CHF 130k–150k'):
            self.assertIn(badge, message)


class ExcludedCompanyTests(unittest.TestCase):
    def test_excluded_company_is_hard_filtered_like_a_language(self):
        original = digest.PREFERENCES.get('excluded_companies', [])
        digest.PREFERENCES['excluded_companies'] = ['Current Employer']
        try:
            with tempfile.TemporaryDirectory() as tmp:
                with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                    job_store.import_watch_report(db, {'jobs': [
                        {'company': 'Current Employer', 'id': '1', 'title': 'SRE', 'location': 'Zurich',
                         'url': 'https://x.test/1', 'description': 'd'},
                        {'company': 'current employer', 'id': '2', 'title': 'SRE', 'location': 'Zurich',
                         'url': 'https://x.test/2', 'description': 'd'},
                        {'company': 'Other Co', 'id': '3', 'title': 'SRE', 'location': 'Zurich',
                         'url': 'https://x.test/3', 'description': 'd'}]})
                    eligible, blocked = digest.eligible_jobs(db)
            self.assertEqual({j['id'] for j in eligible}, {3})
            self.assertEqual({j['id'] for j in blocked}, {1, 2})  # case-insensitive match
        finally:
            digest.PREFERENCES['excluded_companies'] = original


class SalaryTests(unittest.TestCase):
    def test_salary_shows_only_the_figure(self):
        self.assertIsNone(digest._salary('In the UK, the base compensation range for this role'))
        self.assertEqual(digest._salary('In the UK, the Base compensation range for this role is £92,000 - £110,000.'),
                         '£92,000 - £110,000')
        self.assertEqual(digest._salary('CHF 130k–150k'), 'CHF 130k–150k')
        self.assertEqual(digest._salary('SEK 878,578 - SEK 1,054,294'), 'SEK 878,578 - SEK 1,054,294')
        self.assertIsNone(digest._salary('Team of 12 engineers, founded 2019'))


if __name__ == '__main__':
    unittest.main()
