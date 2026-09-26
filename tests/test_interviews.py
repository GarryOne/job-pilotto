import io
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import interviews
from src.notion import ledger

NOW = datetime(2026, 9, 26, 15, 0, tzinfo=timezone.utc)
SRT = """1
00:00:01,000 --> 00:00:04,000
<v Interviewer>How do you handle a Kubernetes upgrade?

2
00:00:04,500 --> 00:00:09,000
We drain nodes one pool at a time and watch error budgets.

3
00:00:09,500 --> 00:00:12,000
We drain nodes one pool at a time and watch error budgets.
"""
RESULT = {'application': 1, 'company': 'Grafana Labs', 'round': 'Technical 1', 'interviewers': ['SRE manager'],
          'duration_min': 45, 'questions': [
              {'topic': 'Kubernetes upgrades', 'question': 'How do you upgrade?', 'answer': 'Drain pools', 'quality': 'strong', 'better': ''},
              {'topic': 'Postgres replication', 'question': 'Explain failover', 'answer': 'Vague', 'quality': 'weak',
               'better': 'Mention Patroni and your RTO numbers'}],
          'strengths': ['Clear upgrade process'], 'weaknesses': ['Database depth'], 'signals': ['Team of 6'],
          'red_flags': [], 'next_step': 'System design next week', 'practice': ['Postgres HA'], 'overall': 'positive',
          'summary': 'Went well overall.'}


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def app(page_id, company, stage, applied):
    return {'id': page_id, 'properties': {'Company': text(company), 'Job': {'type': 'title', 'title': [{'plain_text': 'SRE'}]},
                                          'Stage': {'type': 'select', 'select': {'name': stage}},
                                          'Applied on': {'type': 'date', 'date': {'start': applied}},
                                          'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}}


class FakeTracker:
    database_id = 'apps'

    def __init__(self, apps):
        self.apps, self.requests, self.updates, self.created = apps, [], [], []

    def query_database(self, database_id, filter_=None):
        return self.apps

    def page_text(self):
        return 'SRE at Sonar; Kubernetes, AWS.'

    def _request(self, method, path, body):
        self.requests.append(body)
        return {'id': 'interview-1', 'url': 'https://notion.test/interview-1'}

    def create_page(self, database_id, properties):
        self.created.append((database_id, properties))
        return {'id': 'event'}

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))


class FakeClient:
    def __init__(self):
        self.calls, self.messages = [], self

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(RESULT))],
                               usage=SimpleNamespace(input_tokens=15000, output_tokens=2000,
                                                     cache_read_input_tokens=0, cache_creation_input_tokens=0))


def opener_for(name, body):
    def opener(url, timeout=None):
        if 'getFile' in url:
            return io.BytesIO(json.dumps({'ok': True, 'result': {'file_path': f'documents/{name}'}}).encode())
        return io.BytesIO(body.encode())
    return opener


class InterviewTests(unittest.TestCase):
    def test_subtitles_are_cleaned(self):
        cleaned = interviews.clean(SRT)
        self.assertEqual(cleaned.splitlines(), ['How do you handle a Kubernetes upgrade?',
                                                'We drain nodes one pool at a time and watch error budgets.'])
        self.assertEqual(interviews.clean('plain notes\n'), 'plain notes')

    def test_file_is_analysed_linked_logged_and_sent(self):
        apps = [app('a-new', 'Anthropic', 'Applied', '2026-09-25'), app('g-1', 'Grafana Labs', 'Applied', '2026-09-20'),
                app('o-1', 'Acme', 'Offer', '2026-09-01')]
        tracker, client, sent, stats = FakeTracker(apps), FakeClient(), [], {}
        log = interviews.run(tracker, file_id='F1', note='Grafana, round 1', token='t', send=sent.append,
                             client=client, now=NOW, opener=opener_for('call.srt', SRT), stats=stats)
        self.assertIn('Grafana Labs, Technical 1, 2 questions', log)
        prompt = client.calls[0]['messages'][0]['content']
        self.assertIn('1. Grafana Labs — SRE (stage Applied', prompt)
        self.assertIn('Caption: Grafana, round 1', prompt)
        self.assertNotIn('-->', prompt)
        body = tracker.requests[0]
        props = body['properties']
        self.assertEqual(props['Application'], {'relation': [{'id': 'g-1'}]})
        self.assertEqual(props['Weak topics']['rich_text'][0]['text']['content'], 'Postgres replication')
        self.assertEqual((props['Questions']['number'], props['Weak answers']['number']), (2, 1))
        self.assertEqual(props['Input'], {'select': {'name': 'Transcript'}})
        self.assertAlmostEqual(props['Cost (USD)']['number'], 0.05)  # 15k in x $2 + 2k out x $10
        self.assertLessEqual(len(body['children']), 100)
        self.assertEqual(tracker.created[0][0], ledger.EVENTS_DATABASE_ID)
        self.assertEqual(tracker.created[0][1]['Kind'], {'select': {'name': 'Interviewing'}})
        self.assertEqual(tracker.updates, [('g-1', {'Stage': {'select': {'name': 'Interviewing'}}})])
        self.assertIn('⚠️ <b>Weak answers (1 of 2)</b>', sent[0])
        self.assertIn('Mention Patroni', sent[0])
        self.assertEqual(stats['tokens_in'], 15000)

    def test_later_stage_is_not_moved_back_and_unknown_application_is_unlinked(self):
        tracker = FakeTracker([app('o-1', 'Acme', 'Offer', '2026-09-01')])
        global RESULT
        original, RESULT = RESULT, dict(RESULT, application=0)
        try:
            interviews.run(tracker, note='/interview Acme final\n' + 'They asked about on-call. ' * 5,
                           client=FakeClient(), now=NOW)
        finally:
            RESULT = original
        self.assertEqual(tracker.updates, [])  # Offer stays Offer
        self.assertEqual(tracker.requests[0]['properties']['Input'], {'select': {'name': 'Notes'}})
        tracker = FakeTracker([])
        sent = []
        interviews.run(tracker, note='/interview Mystery Co\n' + 'Long notes about the call. ' * 5,
                       client=FakeClient(), now=NOW, send=sent.append)
        self.assertNotIn('Application', tracker.requests[0]['properties'])
        self.assertIn('not linked to an application', sent[0])
        self.assertEqual(tracker.created, [])

    def test_refuses_audio_and_empty_notes(self):
        with self.assertRaises(ValueError):
            interviews.run(FakeTracker([]), file_id='F', token='t', opener=opener_for('call.m4a', 'x' * 100),
                           client=FakeClient())
        with self.assertRaises(ValueError):
            interviews.run(FakeTracker([]), note='/interview Grafana', client=FakeClient())

    def test_stats_for_insights(self):
        rows = [{'properties': {'Topics': text('Kubernetes; Postgres'), 'Weak topics': text('Postgres'),
                                'Overall': {'type': 'select', 'select': {'name': 'positive'}}}},
                {'properties': {'Topics': text('Postgres'), 'Weak topics': text('Postgres'),
                                'Overall': {'type': 'select', 'select': {'name': 'neutral'}}}}]
        stats = interviews.stats_for_insights(FakeTracker(rows))
        self.assertEqual(stats['topics_asked'], {'Postgres': 2, 'Kubernetes': 1})
        self.assertEqual(stats['topics_answered_weakly'], {'Postgres': 2})
        self.assertEqual(stats['overall'], {'positive': 1, 'neutral': 1, 'negative': 0})


if __name__ == '__main__':
    unittest.main()
