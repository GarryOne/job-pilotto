"""Interview prep kit: asks for the role when it's unknown, then builds a kit on the job's page (src/ai/prep.py)."""
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from src.ai import prep

NOW = datetime(2026, 9, 29, 14, 0, tzinfo=timezone.utc)
INVITE = """## 🤝 Recruiter message
Subject: Connect Igor / Jaya - SRE
Microsoft Teams meeting
Join: https://teams.microsoft.com/meet/314
Meeting ID: 314 743 971 982 217
Passcode: bJ6Np22T"""
ROLE = """## 🧾 Job description
Principal SRE for a global AI company, remote. You own the reliability of large AWS and Kubernetes platforms that
serve model training and inference, lead incident management and postmortems, and build the observability stack.
Hands-on: Terraform, ArgoCD, Kafka, Prometheus and Grafana. You mentor a team of five SREs and work closely with the
ML platform engineers on capacity planning, SLOs and on-call. Experience running large production systems is a must."""


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def job(page_text):
    row = {'id': 'h1', 'properties': {'Job': {'type': 'title', 'title': [{'plain_text': 'Principal SRE'}]}, 'Company': text(''),
                                      'Via': text('Huxley'), 'Contact': text('Jayantie Nejati'), 'Salary': text(''),
                                      'Stage': {'type': 'select', 'select': {'name': 'Interview scheduled'}},
                                      'Next interview': {'type': 'date', 'date': {'start': '2026-09-30T08:30:00+02:00'}},
                                      'Job URL': {'type': 'url', 'url': 'https://mail.google.com/mail/u/0/#all/h1'}}}
    tracker = SimpleNamespace(written=[], updates=[], page_text=lambda page_id='profile': page_text if page_id == 'h1' else 'Igor: 10 years, SRE at Sonar',
                              replace_after_heading=lambda *a: tracker.written.append(a), update_page=lambda *a: tracker.updates.append(a))
    return tracker, row


KIT = {'interview_type': 'recruiter screen', 'assess': ['motivation'], 'questions': [{'question': 'Why this role?', 'answer_with': 'Sonar SRE work'}],
       'stories': ['Incident at Sonar'], 'gaps': [], 'ask_them': ['Who is the client?'], 'plan': ['Read the description'], 'unknowns': ['salary']}


class Client:
    def __init__(self):
        self.messages, self.calls = self, []

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(KIT))],
                               usage=SimpleNamespace(input_tokens=4000, output_tokens=900, cache_read_input_tokens=0, cache_creation_input_tokens=0))


class PrepTests(unittest.TestCase):
    def test_an_invite_alone_is_not_a_role_it_asks_for_the_description(self):
        tracker, row = job(INVITE)
        tracker._children = lambda block_id: []  # no screenshots on the page either
        client = Client()
        result = prep.build(tracker, row, client=client, now=NOW)
        self.assertTrue(result['needs_description'])
        self.assertEqual(client.calls, [])  # nothing spent

    def test_with_the_description_it_builds_the_kit_on_the_job(self):
        tracker, row = job(INVITE + '\n' + ROLE)
        tracker.database_id = 'apps'
        past = {'id': 'r1', 'last_edited_time': '2026-09-20', 'properties': {'Company': text('Grafana Labs'), 'Via': text(''),
                'Rejection lesson': text('Lead with incident stories that show the outcome'), 'Employer feedback': text('')}}
        tracker.query_database = lambda db, filter_=None: [past]
        client = Client()
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {'Kafka tuning': 2}, 'topics_asked': {'SLOs': 3}}):
            result = prep.build(tracker, row, client=client, now=NOW)
        self.assertTrue(result['ok'], result)
        prompt = client.calls[0]['messages'][0]['content']
        self.assertIn('Kafka tuning', prompt)
        self.assertIn('Topics interviewers asked most: SLOs', prompt)
        self.assertIn('Grafana Labs: Lead with incident stories that show the outcome', prompt)  # what it learned from you
        self.assertIn('ArgoCD', prompt)
        self.assertIn('16 h from now', prompt)  # Wed 08:30 CEST = 06:30 UTC
        heading, blocks = tracker.written[0][1], tracker.written[0][2]
        self.assertEqual(heading, prep.HEADING)
        self.assertIn('Still unknown: ask the recruiter', [b[b['type']]['rich_text'][0]['text']['content'] for b in blocks if b['type'] == 'heading_3'])
        self.assertEqual(tracker.updates[0][1], {'Interview prep': {'date': {'start': '2026-09-29'}}})

    def test_screenshots_logged_on_the_job_are_read_instead_of_asking(self):
        # 29 Sep 2026: the Huxley chat was logged as 4 images before the Log box kept its text; the kit asked anyway.
        tracker, row = job(INVITE)
        folded = {'id': 'log1', 'type': 'toggle', 'has_children': True}
        image = lambda n: {'id': f'i{n}', 'type': 'image', 'image': {'type': 'file', 'file': {'url': f'https://files.test/{n}.png'}}}
        tracker._children = lambda block_id: [image(1), folded] if block_id == 'h1' else [image(2)]
        read = ROLE.split('\n', 1)[1]

        class Reads(Client):
            def create(self, **params):
                if params['model'] == prep.READ_MODEL:
                    self.calls.append(params)
                    return SimpleNamespace(content=[SimpleNamespace(type='text', text=read)],
                                           usage=SimpleNamespace(input_tokens=5000, output_tokens=300, cache_read_input_tokens=0, cache_creation_input_tokens=0))
                return super().create(**params)

        class Image:
            headers = {'Content-Type': 'image/png'}
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'png'
        client = Reads()
        with mock.patch('urllib.request.urlopen', lambda url, timeout=30: Image()), \
                mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}):
            result = prep.build(tracker, row, client=client, now=NOW)
        self.assertTrue(result['ok'], result)
        self.assertEqual(len([b for b in client.calls[0]['messages'][0]['content'] if b['type'] == 'image']), 2)  # both, the folded one too
        self.assertEqual(tracker.written[0][1], prep.DESCRIPTION_HEADING)  # kept as the job's description
        self.assertIn('ArgoCD', client.calls[1]['messages'][0]['content'])

    def test_a_cut_off_answer_says_so_and_writes_nothing(self):
        tracker, row = job(INVITE + '\n' + ROLE)
        tracker.database_id = 'apps'
        tracker.query_database = lambda db, filter_=None: []
        client = Client()
        cut = SimpleNamespace(content=[SimpleNamespace(type='text', text='{"interview_type": "technical", "assess": ["SL')],
                              usage=SimpleNamespace(input_tokens=4000, output_tokens=8000, cache_read_input_tokens=0, cache_creation_input_tokens=0),
                              stop_reason='max_tokens')
        client.create = lambda **params: cut
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {}):
            with self.assertRaisesRegex(RuntimeError, 'cut off'):
                prep.build(tracker, row, client=client, now=NOW)
        self.assertEqual(tracker.written, [])

    def test_a_pasted_description_is_saved_on_the_job(self):
        tracker, row = job(INVITE)
        self.assertTrue(prep.describe(tracker, row, text=ROLE.split('\n', 1)[1])['ok'])
        self.assertEqual(tracker.written[0][1], prep.DESCRIPTION_HEADING)
        self.assertFalse(prep.describe(tracker, row, text='SRE role')['ok'])


class LoggedRunTests(unittest.TestCase):
    def test_a_kit_is_recorded_as_a_run_with_its_ai_cost(self):
        tracker, row = job(INVITE + '\n' + ROLE)
        logged = []
        with mock.patch('src.ai.interviews.stats_for_insights', lambda t: {'topics_answered_weakly': {}}), \
                mock.patch('src.notion.cron_runs.begin', lambda t, run: None), \
                mock.patch('src.notion.cron_runs.log_run', lambda t, run, failed=False: logged.append((run, failed))):
            result = prep.logged_build(tracker, row, client=Client(), now=NOW)
        self.assertTrue(result['ok'])
        run, failed = logged[0]
        self.assertEqual((run['mode'], failed), ('prep', False))
        self.assertGreater(run['interview']['usd'], 0)  # counted in the month's AI budget
        self.assertIn('Huxley · Principal SRE', run['headline'])

    def test_the_row_opens_as_running_and_a_failure_is_recorded_with_its_error(self):
        tracker, row = job(INVITE + '\n' + ROLE)
        opened, logged = [], []

        def broken(*a, **k):
            raise RuntimeError('Notion refused the page')
        with mock.patch('src.notion.cron_runs.begin', lambda t, run: opened.append(run['mode'])), \
                mock.patch('src.notion.cron_runs.log_run', lambda t, run, failed=False: logged.append((run, failed))), \
                mock.patch.object(prep, 'build', broken):
            result = prep.logged_build(tracker, row, client=Client(), now=NOW)
        self.assertEqual(opened, ['prep'])  # Recent activity shows it while it runs
        run, failed = logged[0]
        self.assertTrue(failed)
        self.assertIn('Notion refused the page', run['headline'])  # the error is kept, not only in the dialog
        self.assertFalse(result['ok'])

if __name__ == '__main__':
    unittest.main()
