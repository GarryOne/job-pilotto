"""A pasted job link is scored and written to Job Matches as Open. It is not an application."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import desktop, import_url, store

FACTS = {'languages': [], 'english_is_enough': {'value': 'yes', 'evidence': ''},
         'seniority': {'value': 'senior', 'evidence': ''}, 'work_mode': {'value': 'remote', 'remote_scope': 'Europe', 'evidence': ''},
         'workload': {'value': '100%', 'evidence': ''}, 'salary': {'stated': True, 'text': '€70k–90k'},
         'employer_type': {'value': 'recruiter', 'evidence': ''}, 'role_family': 'DevOps', 'technologies': ['AWS', 'EKS'],
         'on_call': {'value': 'unknown', 'evidence': ''}, 'visa_sponsorship': {'value': 'unknown', 'evidence': ''},
         'confidence': 'high'}
FIT = {'score': 81, 'tier': 'A', 'reason': 'AWS/EKS ownership', 'strengths': ['EKS'], 'gaps': ['Aurora'], 'confidence': 'high',
       'components': {'role_fit': 90, 'location': 80, 'compensation': 60, 'growth': 70, 'risk': 40}}
POSTING = 'Own AWS and EKS: networking, DNS, load balancing. Run Aurora PostgreSQL in production. Terraform + Argo CD. ' * 2
URL = 'https://boards.greenhouse.io/acme/jobs/1'
AI_ON = {'ANTHROPIC_API_KEY': 'sk-test', 'NOTION_TOKEN': 'secret-test',
         'JOB_PILOTTO_ENRICH_MODEL': 'claude-haiku-4-5', 'JOB_PILOTTO_SCORE_MODEL': 'claude-sonnet-5'}
META = {'title': 'Senior DevOps Engineer', 'company': 'Acme', 'location': 'Remote', 'description': POSTING}


class Client:
    def __init__(self, *answers):
        self.answers, self.calls, self.messages = list(answers), [], self

    def create(self, **params):
        self.calls.append(params['model'])
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answers.pop(0)))],
                               stop_reason='end_turn',
                               usage=SimpleNamespace(input_tokens=1000, output_tokens=300, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


class Tracker:
    def __init__(self, application=None, match_pages=None):
        self.application = application
        self.match_pages = list(match_pages or [])
        self.matches = []
        self.applications = []

    def find(self, url):
        return self.application

    def query_database(self, database_id, filter_=None):
        return self.match_pages

    def upsert_match(self, props, page_id=None):
        self.matches.append((page_id, props))
        return page_id or 'match-1'

    def add_application(self, *args, **kwargs):
        self.applications.append(args)

    def page_text(self):
        return ''


class ImportUrlTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = store.connect(Path(self.tmp.name) / 'jobs.sqlite')

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def run_import(self, tracker, client, url=URL, meta=META, profile='Profile: SRE in Zurich'):
        with mock.patch.dict('os.environ', AI_ON, clear=False), \
                mock.patch.object(import_url.ledger, 'page_meta', lambda _url: dict(meta)), \
                mock.patch.object(import_url, 'local_profile', lambda: profile):
            return import_url.run(self.db, tracker, url, client=client, stats={})

    def test_a_link_is_scored_and_written_as_an_open_match_not_an_application(self):
        tracker, client = Tracker(), Client(FACTS, FIT)
        outcome = self.run_import(tracker, client)
        self.assertTrue(outcome['ok'])
        self.assertTrue(outcome['created'])
        self.assertIn('fit 81/100, tier A', outcome['line'])
        self.assertEqual(client.calls, ['claude-haiku-4-5', 'claude-sonnet-5'])
        self.assertEqual(tracker.applications, [])
        page_id, props = tracker.matches[0]
        self.assertIsNone(page_id)
        self.assertEqual(props['Status'], {'select': {'name': 'Open'}})
        self.assertEqual(props['Job URL'], {'url': URL})
        row = self.db.execute(
            'SELECT jobs.notes, sources.name, sources.kind, applications.status FROM jobs '
            'JOIN sources ON sources.id = jobs.source_id JOIN applications ON applications.job_id = jobs.id'
        ).fetchone()
        self.assertEqual((row['notes'], row['name'], row['kind'], row['status']),
                         ('imported', 'Imported link', 'job board', 'unreviewed'))
        again = self.run_import(tracker, Client(FACTS, FIT))
        self.assertFalse(again['created'])
        self.assertEqual(again['row']['id'], 'match-1')
        self.assertEqual(len(tracker.matches), 1)

    def test_a_match_already_in_notion_is_updated_instead_of_posted_again(self):
        tracker = Tracker(match_pages=[{'id': 'match-existing', 'properties': {}}])
        outcome = self.run_import(tracker, Client(FACTS, FIT))
        self.assertFalse(outcome['created'])
        self.assertEqual(tracker.matches[0][0], 'match-existing')

    def test_an_unreadable_page_is_refused_before_any_model_call(self):
        client = Client(FACTS, FIT)
        with self.assertRaises(ValueError) as raised:
            self.run_import(Tracker(), client, meta={'title': 'Role', 'description': 'too short'})
        self.assertIn('could not be read', str(raised.exception))
        self.assertEqual(client.calls, [])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 0)

    def test_linkedin_is_refused_without_a_model_call(self):
        client = Client(FACTS, FIT)
        with mock.patch.dict('os.environ', AI_ON, clear=False), \
                mock.patch.object(import_url, 'local_profile', lambda: 'Profile: SRE'):
            with self.assertRaises(ValueError):
                import_url.run(self.db, Tracker(), 'https://www.linkedin.com/jobs/view/1', client=client, stats={})
        self.assertEqual(client.calls, [])

    def test_a_job_already_in_applications_is_left_alone(self):
        tracker = Tracker(application={
            'id': 'app-1',
            'properties': {'Stage': {'select': {'name': 'Applied'}},
                           'Job': {'title': [{'plain_text': 'Senior DevOps Engineer'}]}},
        })
        client = Client(FACTS, FIT)
        outcome = self.run_import(tracker, client)
        self.assertFalse(outcome['created'])
        self.assertIn('Already in your applications (Applied)', outcome['line'])
        self.assertEqual(client.calls, [])
        self.assertEqual(tracker.matches, [])

    def test_scoring_waits_for_a_profile_and_does_not_call_the_model(self):
        client = Client(FACTS, FIT)
        with self.assertRaises(ValueError) as raised:
            self.run_import(Tracker(), client, profile='')
        self.assertIn('profile', str(raised.exception).lower())
        self.assertEqual(client.calls, [])

    def test_an_imported_job_stays_in_the_list_when_its_company_is_excluded(self):
        self.run_import(Tracker(), Client(FACTS, FIT))
        notion_jobs = [{'url': URL, 'title': 'Senior DevOps Engineer', 'company': 'Acme',
                        'match_status': 'Open', 'fit': 81, 'reason': 'AWS/EKS ownership'}]
        with mock.patch.dict(desktop.digest.PREFERENCES, {'excluded_companies': ['Acme']}):
            shown = desktop.jobs(self.db, notion_jobs=notion_jobs)['jobs']
        self.assertEqual([job['url'] for job in shown], [URL])
        self.assertEqual(shown[0]['status'], 'unreviewed')


if __name__ == '__main__':
    unittest.main()
