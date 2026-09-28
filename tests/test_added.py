import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import store
from src.ai import added
from src.notion import ledger

FACTS = {'languages': [], 'english_is_enough': {'value': 'yes', 'evidence': ''},
         'seniority': {'value': 'senior', 'evidence': ''}, 'work_mode': {'value': 'remote', 'remote_scope': 'Europe', 'evidence': ''},
         'workload': {'value': '100%', 'evidence': ''}, 'salary': {'stated': True, 'text': '€70k–90k'},
         'employer_type': {'value': 'recruiter', 'evidence': ''}, 'role_family': 'DevOps', 'technologies': ['AWS', 'EKS'],
         'on_call': {'value': 'unknown', 'evidence': ''}, 'visa_sponsorship': {'value': 'unknown', 'evidence': ''},
         'confidence': 'high'}
FIT = {'score': 81, 'tier': 'A', 'reason': 'AWS/EKS ownership', 'strengths': ['EKS'], 'gaps': ['Aurora'], 'confidence': 'high',
       'components': {'role_fit': 90, 'location': 80, 'compensation': 60, 'growth': 70, 'risk': 40}}
POSTING = 'Own AWS and EKS: networking, DNS, load balancing. Run Aurora PostgreSQL in production. Terraform + Argo CD. ' * 2
AI_ON = {'ANTHROPIC_API_KEY': 'sk-test', 'NOTION_TOKEN': 'secret-test', 'JOB_PILOTTO_ENRICH_MODEL': 'claude-haiku-4-5', 'JOB_PILOTTO_SCORE_MODEL': 'claude-sonnet-5'}


class Client:
    def __init__(self, *answers):
        self.answers, self.calls, self.messages = list(answers), [], self

    def create(self, **params):
        self.calls.append(params['model'])
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answers.pop(0)))], stop_reason='end_turn',
                               usage=SimpleNamespace(input_tokens=1000, output_tokens=300, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


class Tracker:
    database_id = 'apps'

    def __init__(self):
        self.matches, self.updates = [], []

    def query_database(self, database_id, filter_=None):
        return []

    def upsert_match(self, props, page_id=None):
        self.matches.append((page_id, props))
        return 'match-1'

    def update_page(self, page_id, props):
        self.updates.append((page_id, props))

    def page_text(self):
        return 'Profile: SRE in Zurich'


class AddedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = store.connect(Path(self.tmp.name) / 'jobs.sqlite')

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def process(self, tracker, client, job=None, row=None, env=AI_ON):
        stats = {}
        with mock.patch.dict('os.environ', env, clear=False), mock.patch.object(added, 'local_profile', lambda: None):
            line = added.process(self.db, tracker, 'https://x.test/job/1',
                                 job or {'title': 'Senior DevOps Engineer', 'company': 'Acme', 'description': POSTING},
                                 row=row, client=client, stats=stats)
        return line, stats

    def test_a_job_you_add_gets_facts_a_fit_score_and_a_job_matches_row_like_a_found_one(self):
        tracker, client = Tracker(), Client(FACTS, FIT)
        row = {'id': 'app-1', 'properties': {'Salary': {'type': 'rich_text', 'rich_text': []}}}
        line, stats = self.process(tracker, client, row=row)
        self.assertEqual(line, 'fit 81/100, tier A')
        self.assertEqual(client.calls, ['claude-haiku-4-5', 'claude-sonnet-5'])
        props = tracker.matches[0][1]
        self.assertEqual((props['Score'], props['Status'], props['Seniority'], props['Work mode']),
                         ({'number': 81}, {'select': {'name': 'Applied'}}, {'select': {'name': 'Senior'}}, {'select': {'name': 'Remote'}}))
        self.assertEqual(props['Technologies']['rich_text'][0]['text']['content'], 'AWS; EKS')
        page, changes = tracker.updates[0]
        self.assertEqual(page, 'app-1')
        self.assertEqual(changes['Fit score'], {'number': 81})
        self.assertEqual(changes['Tier'], {'select': {'name': 'A'}})
        self.assertEqual(changes['Salary']['rich_text'][0]['text']['content'], '€70k–90k')
        self.assertGreater(stats['enrich']['usd'] + stats['score']['usd'], 0)
        self.assertEqual(self.db.execute('SELECT page_id FROM notion_matches').fetchone()['page_id'], 'match-1')

    def test_nothing_runs_without_the_ai_stages_or_a_description_or_for_a_job_already_scored(self):
        env_off = {'JOB_PILOTTO_DISABLE': 'score'}
        self.assertIsNone(self.process(Tracker(), Client(), env={**AI_ON, **env_off})[0])
        self.assertIsNone(self.process(Tracker(), Client(), job={'title': 'SRE', 'description': 'short'})[0])
        self.process(Tracker(), Client(FACTS, FIT))
        tracker = Tracker()
        self.assertIsNone(self.process(tracker, Client())[0])  # the same job again: already scored
        self.assertEqual(tracker.matches, [])

    def test_a_message_without_a_posting_is_described_from_what_was_read(self):
        text = added.description_of({'title': 'SRE', 'client': 'logistics software', 'salary': '€120k', 'work_mode': 'Remote'})
        self.assertEqual(text, 'Role: SRE\nEmployer (not named): logistics software\nWork mode: Remote\nSalary: €120k')


class DailyAddTests(unittest.TestCase):
    def test_a_linkedin_application_is_scored_from_the_details_you_paste_before_its_record_is_frozen(self):
        from src import daily
        order, seen = [], {}

        def process(db, tracker, url, meta, stats=None):
            order.append('ai'); seen.update(meta)
            return 'fit 81/100, tier A'

        def add_application(tracker, url, **kwargs):
            order.append('record')
            return 'Tracked: Senior SRE — Acme'
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        argv = ['daily', '--mode', 'add', '--job', 'https://www.linkedin.com/jobs/view/1', '--note', 'two days ago',
                '--job-title', 'Senior SRE', '--job-company', 'Acme', '--job-text', POSTING, '--db', str(Path(tmp.name) / 'j.sqlite')]
        tracker = SimpleNamespace(query_database=lambda *a, **k: [])
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(daily.notion.Tracker, 'from_env', lambda: tracker), \
                mock.patch.object(added, 'process', process), mock.patch.object(ledger, 'add_application', add_application), \
                mock.patch.object(ledger, 'company_for', lambda t, u, m: m.get('company')), \
                mock.patch.object(daily, 'queue_mail_check', lambda: False), mock.patch('builtins.print') as printed:
            self.assertEqual(daily.main(), 0)
        self.assertEqual(order, ['ai', 'record'])
        self.assertEqual((seen['title'], seen['company'], seen['description']), ('Senior SRE', 'Acme', POSTING.strip()))
        self.assertIn('fit 81/100, tier A', printed.call_args_list[-1].args[0])


class NoFetchTests(unittest.TestCase):
    def test_linkedin_and_glassdoor_pages_are_never_fetched(self):
        opener = mock.Mock(side_effect=AssertionError('fetched'))
        self.assertEqual(ledger.page_meta('https://www.linkedin.com/jobs/view/123', opener=opener), {})
        self.assertEqual(ledger.page_meta('https://www.glassdoor.ch/job-listing/x', opener=opener), {})
        self.assertTrue(ledger.no_fetch('https://ch.indeed.com/viewjob?jk=1'))
        self.assertFalse(ledger.no_fetch('https://boards.greenhouse.io/acme/jobs/1'))


if __name__ == '__main__':
    unittest.main()
