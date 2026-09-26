import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import insights
from src.notion import ledger

NOW = datetime(2026, 9, 26, 5, 0, tzinfo=timezone.utc)
PROFILE = 'SRE with Kubernetes, AWS (Amazon Web Services), Terraform, Datadog and Python.'


def facts(techs, language=None, salary='', seniority='senior', family='sre'):
    return {'technologies': techs, 'languages': [{'language': language, 'level': 'required', 'evidence': ''}] if language else [],
            'english_is_enough': {'value': 'yes', 'evidence': ''}, 'seniority': {'value': seniority, 'evidence': ''},
            'work_mode': {'value': 'hybrid', 'remote_scope': '', 'evidence': ''}, 'salary': {'stated': bool(salary), 'text': salary},
            'employer_type': {'value': 'direct_employer', 'evidence': ''}, 'role_family': family}


def fit(score, gaps=()):
    return {'score': score, 'gaps': list(gaps), 'components': {'role_fit': score, 'location': 80, 'compensation': 40,
                                                               'growth': 70, 'risk': 30}}


JOBS = [
    {'id': 1, 'title': 'SRE', 'company': 'A', 'location': 'Zürich', 'city': 'Zürich', 'first_seen_at': '2026-09-25T00:00:00+00:00'},
    {'id': 2, 'title': 'Platform Engineer', 'company': 'B', 'location': 'Berlin', 'city': '', 'first_seen_at': '2026-09-01T00:00:00+00:00'},
    {'id': 3, 'title': 'DevOps', 'company': 'C', 'location': 'Bern', 'city': 'Bern', 'first_seen_at': '2026-09-24T00:00:00+00:00'},
    {'id': 4, 'title': 'SRE', 'company': 'D', 'location': 'London', 'city': '', 'first_seen_at': '2026-09-20T00:00:00+00:00'},
]
FACTS = {1: facts(['Kubernetes', 'Prometheus', 'AWS']), 2: facts(['k8s', 'Prometheus', 'Go'], salary='EUR 90k'),
         3: facts(['Ansible'], language='German'), 4: facts(['Prometheus', 'GCP'])}
FITS = {1: fit(75, ['no Prometheus shown']), 2: fit(62), 4: fit(50, ['GCP depth'])}


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def app_row(page_id, stage, applied, **extra):
    props = {'Stage': {'type': 'select', 'select': {'name': stage}},
             'Applied on': {'type': 'date', 'date': {'start': applied}}, 'Location': text(extra.get('location', 'Zürich')),
             'Seniority': {'type': 'select', 'select': {'name': extra.get('seniority', 'Senior')}},
             'Fit score': {'type': 'number', 'number': extra.get('score')},
             'Days to apply': {'type': 'number', 'number': extra.get('days')},
             'Cover letter': {'type': 'checkbox', 'checkbox': True}}
    return {'id': page_id, 'properties': props}


class FakeTracker:
    database_id = 'apps'

    def __init__(self, apps=(), events=(), past=()):
        self.apps, self.events, self.past, self.created = list(apps), list(events), list(past), []

    def query_database(self, database_id, filter_=None):
        if database_id == ledger.EVENTS_DATABASE_ID:
            return self.events
        if database_id == insights.INSIGHTS_DATABASE_ID:
            if filter_ and 'date' in filter_:
                return [r for r in self.past if r['properties']['Date']['date']['start'] == filter_['date']['equals']]
            return self.past
        return self.apps

    def page_text(self):
        return PROFILE

    def create_page(self, database_id, properties):
        self.created.append((database_id, properties))
        return {'id': '4c79aec0-91df-4dcc-8a88-27cd4d43a5ef'}

    def _request(self, method, path, body):
        self.created.append((body['parent']['database_id'], body['properties'], body.get('children')))
        return {'id': '4c79aec0-91df-4dcc-8a88-27cd4d43a5ef', 'url': 'https://notion.test/weekly'}


INSIGHT = {'skip': False, 'category': 'Skills', 'headline': 'Prometheus is in 3/3 of your eligible jobs & not on your CV',
           'evidence': ['Prometheus: 3/3 eligible jobs (100%)', 'Kubernetes: 2/3 (67%)'],
           'action': 'Add Prometheus work to the CV if you have it; otherwise a 2-week project.',
           'confidence': 'medium', 'basis': 'Market', 'sample_size': 3}


class FakeClient:
    def __init__(self, answer=INSIGHT):
        self.calls, self.messages = [], self
        self.answer = answer

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.answer))],
                               usage=SimpleNamespace(input_tokens=6000, output_tokens=400, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


def patched():
    return mock.patch.multiple('src.ai.insights', store=mock.Mock(digest_jobs=lambda db, limit: [dict(j) for j in JOBS]),
                               enrich=mock.Mock(load=lambda db: FACTS), score=mock.Mock(load=lambda db: FITS))


class MarketTests(unittest.TestCase):
    def test_technology_demand_is_normalized_and_checked_against_the_profile(self):
        with patched():
            stats = insights.market_stats(None, PROFILE, NOW)
        self.assertEqual((stats['open_jobs'], stats['eligible'], stats['language_blocked']), (4, 3, 1))
        techs = {row['tech']: row for row in stats['technologies_in_eligible_jobs']}
        self.assertEqual(techs['prometheus']['jobs'], '3/3 (100%)')
        self.assertFalse(techs['prometheus']['in_profile'])
        self.assertEqual(techs['kubernetes']['jobs'], '2/3 (67%)')  # k8s counted as kubernetes
        self.assertTrue(techs['kubernetes']['in_profile'])
        self.assertTrue(techs['aws']['in_profile'])
        self.assertEqual(stats['good_fit (score>=60)'], 2)
        self.assertEqual(stats['by_region']['Switzerland (other)']['language_blocked'], 1)
        self.assertEqual(stats['new_last_7_days'], 3)
        self.assertEqual(stats['salary_stated'], '1/3 (33%)')
        self.assertEqual(stats['fit_components_avg_near_miss']['compensation'], 40)

    def test_in_profile_uses_word_boundaries_and_aliases(self):
        self.assertTrue(insights.in_profile('aws', 'amazon web services certified'))
        self.assertFalse(insights.in_profile('go', 'google cloud'))
        self.assertTrue(insights.in_profile('go', 'python, go, rust'))


class ApplicationTests(unittest.TestCase):
    def test_outcomes_and_small_groups(self):
        apps = [app_row('p1', 'Applied', '2026-09-24', score=80, days=2),
                app_row('p2', 'Rejected', '2026-09-01', location='Berlin', score=55, days=10),
                app_row('p3', 'Applied', '2026-09-10')]
        events = [{'properties': {'Kind': {'type': 'select', 'select': {'name': 'Screening'}},
                                  'Application': {'type': 'relation', 'relation': [{'id': 'p-3'}]}}}]
        stats = insights.application_stats(FakeTracker(apps, events), NOW)
        self.assertEqual(stats['outcomes'], {'waiting': 1, 'rejected': 1, 'interview': 1})
        self.assertEqual(stats['interview_rate_of_decided'], '1/2 (50%)')
        self.assertEqual(stats['applied_last_7_days'], 1)
        self.assertEqual(stats['days_since_last_application'], 2)
        self.assertTrue(stats['by_group']['Region']['Zurich area']['too_small'])
        self.assertEqual(stats['by_group']['Days to apply']['<=3']['waiting'], 1)

    def test_replies_channels_and_time_to_first_reply(self):
        a = app_row('p1', 'Applied', '2026-09-20')
        a['properties']['Channel'] = {'type': 'select', 'select': {'name': 'Recruiter platform'}}
        b = app_row('p2', 'Applied', '2026-09-10')
        b['properties']['Channel'] = {'type': 'select', 'select': {'name': 'Direct'}}
        ev = lambda page, kind, at: {'properties': {'Kind': {'type': 'select', 'select': {'name': kind}},
                                                    'At': {'type': 'date', 'date': {'start': at}},
                                                    'Application': {'type': 'relation', 'relation': [{'id': page}]}}}
        stats = insights.application_stats(FakeTracker([a, b], [ev('p1', 'Reply received', '2026-09-23'),
                                                                 ev('p1', 'Screening', '2026-09-25')]), NOW)
        self.assertEqual(stats['reply_rate_of_all'], '1/2 (50%)')
        self.assertEqual(stats['days_to_first_reply'], [3])
        self.assertEqual(stats['by_group']['Channel']['Recruiter platform']['interview'], 1)
        self.assertEqual(stats['by_group']['Channel']['Direct']['waiting'], 1)

    def test_no_applications(self):
        stats = insights.application_stats(FakeTracker(), NOW)
        self.assertEqual((stats['applications'], stats['days_since_last_application']), (0, None))


class RunTests(unittest.TestCase):
    def test_sends_one_insight_with_feedback_buttons_and_records_cost(self):
        tracker, client, sent, stats = FakeTracker(), FakeClient(), [], {}
        with patched():
            summary = insights.run(None, tracker, 'claude-sonnet-5', send=lambda t, k: sent.append((t, k)),
                                   now=NOW, client=client, stats=stats)
        self.assertIn('Insight sent: Skills', summary)
        text, keyboard = sent[0]
        self.assertIn('&amp; not on your CV', text)  # HTML-escaped
        self.assertIn('👉 Add Prometheus', text)
        self.assertEqual([b['callback_data'] for b in keyboard['inline_keyboard'][0]],
                         [f'ins:{k}:4c79aec091df4dcc8a8827cd4d43a5ef' for k in 'una'])
        props = tracker.created[0][1]
        self.assertEqual(props['Category'], {'select': {'name': 'Skills'}})
        self.assertAlmostEqual(props['Cost (USD)']['number'], 0.016)  # 6000 in x $2 + 400 out x $10
        self.assertEqual((stats['done'], round(stats['usd'], 3)), (1, 0.016))
        payload = json.loads(client.calls[0]['messages'][0]['content'].split('\n', 1)[1])
        self.assertEqual(set(payload), {'market', 'applications', 'interviews', 'recent_insights'})
        self.assertIn(PROFILE, client.calls[0]['system'][0]['text'])

    def test_not_due_before_the_hour_or_twice_a_day(self):
        early = datetime(2026, 9, 26, 2, 30, tzinfo=timezone.utc)
        today = {'properties': {'Date': {'type': 'date', 'date': {'start': '2026-09-26'}}}}
        client = FakeClient()
        self.assertEqual(insights.run(None, FakeTracker(), now=early, client=client), 'Insight: not due')
        self.assertEqual(insights.run(None, FakeTracker(past=[today]), now=NOW, client=client), 'Insight: not due')
        self.assertEqual(client.calls, [])

    def test_force_and_skip(self):
        tracker, sent = FakeTracker(), []
        with patched():
            summary = insights.run(None, tracker, now=datetime(2026, 9, 26, 1, tzinfo=timezone.utc), force=True,
                                   client=FakeClient(dict(INSIGHT, skip=True)), send=lambda t, k: sent.append(t))
        self.assertIn('nothing new today', summary)
        self.assertEqual((tracker.created, sent), ([], []))


WEEKLY = {'headline': 'Quiet week: 2 applications, no replies yet', 'summary': 'You sent 2 applications.',
          'worked': [], 'change': ['Apply within 3 days of posting'], 'focus': 'Five applications in Zurich',
          'confidence': 'low'}


class WeeklyTests(unittest.TestCase):
    def test_monday_sends_the_weekly_report_instead_of_the_daily_insight(self):
        monday = datetime(2026, 9, 28, 5, 0, tzinfo=timezone.utc)
        events = [{'properties': {'Kind': {'type': 'select', 'select': {'name': 'Screening'}},
                                  'At': {'type': 'date', 'date': {'start': '2026-09-25T10:00:00+00:00'}},
                                  'Source': {'type': 'select', 'select': {'name': 'Telegram'}},
                                  'Event': {'type': 'title', 'title': [{'plain_text': 'Screening · Acme'}]},
                                  'Application': {'type': 'relation', 'relation': []}}},
                  {'properties': {'Kind': {'type': 'select', 'select': {'name': 'Applied'}},
                                  'At': {'type': 'date', 'date': {'start': '2026-09-26'}},
                                  'Source': {'type': 'select', 'select': {'name': 'Backfill'}},
                                  'Application': {'type': 'relation', 'relation': []}}}]
        tracker, client, sent, stats = FakeTracker(events=events), FakeClient(WEEKLY), [], {}
        with patched():
            summary = insights.run(None, tracker, 'claude-sonnet-5', send=lambda t, k: sent.append((t, k)),
                                   now=monday, client=client, stats=stats)
        self.assertIn('Weekly report sent', summary)
        database_id, props, children = tracker.created[0]
        self.assertEqual(props['Category'], {'select': {'name': 'Weekly report'}})
        self.assertLessEqual(len(children), 100)
        payload = json.loads(client.calls[0]['messages'][0]['content'].split('\n', 1)[1])
        self.assertEqual(payload['week']['event_counts'], {'Screening': 1})  # backfill events don't count
        self.assertIn('Full report in Notion', sent[0][0])
        self.assertIn('🔧 <b>Change next week</b>', sent[0][0])
        self.assertNotIn('✅ <b>Worked</b>', sent[0][0])  # empty list, no padding
        self.assertEqual(stats['done'], 1)


if __name__ == '__main__':
    unittest.main()
