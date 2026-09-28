import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import focus

NOW = datetime(2026, 9, 28, 15, 0, tzinfo=timezone.utc)  # Monday 17:00 in Zurich


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def row(page_id, company, job, stage='Applied', applied='2026-09-26', interview=None, **extra):
    props = {'Company': text(company), 'Job': {'type': 'title', 'title': [{'plain_text': job}]},
             'Stage': {'type': 'select', 'select': {'name': stage}}, 'Applied on': {'type': 'date', 'date': {'start': applied} if applied else None},
             'Next interview': {'type': 'date', 'date': {'start': interview} if interview else None},
             'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}
    for name, value in extra.items():
        props[name.replace('_', ' ')] = text(value) if isinstance(value, str) else value
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'last_edited_time': '2026-09-28T14:00:00Z', 'properties': props}


def event(page_id, kind, at, note='', source_id=''):
    return {'properties': {'Kind': {'type': 'select', 'select': {'name': kind}}, 'At': {'type': 'date', 'date': {'start': at}},
                           'Note': text(note), 'Source ID': text(source_id),
                           'Application': {'type': 'relation', 'relation': [{'id': page_id}]}}}


class FocusTests(unittest.TestCase):
    def test_answers_come_first_then_interviews_then_applying(self):
        rows = [row('a', 'Duvo.ai', 'SRE', stage='Screening'), row('b', 'Laelaps AI', 'Infra', stage='Screening'),
                row('c', 'Scale AI', 'Infra', interview='2026-09-29T09:00:00+02:00', stage='Interview scheduled'),
                row('d', 'Grafana Labs', 'SRE UK', stage='Kit ready', applied=None, Fit_score={'type': 'number', 'number': 76})]
        events = [event('a', 'Reply received', '2026-09-27T10:00:00Z', 'Asked for times', 'gm1'),
                  event('b', 'Reply received', '2026-09-28T08:00:00Z', 'Please book a slot on Calendly', 'gm2'),
                  event('b', 'Replied', '2026-09-28T09:00:00Z')]
        result = focus.build(rows, events, target=30, now=NOW)
        kinds = [(i['kind'], i['company']) for i in result['items']]
        self.assertEqual(kinds[:3], [('reply', 'Duvo.ai'), ('prepare', 'Scale AI'), ('apply', '')])
        reply = result['items'][0]
        self.assertEqual((reply['link'], reply['done']), ('https://mail.google.com/mail/u/0/#all/gm1', True))
        self.assertIn('yesterday', reply['detail'])
        self.assertIn('1 kit ready (Grafana Labs…)', result['items'][2]['detail'])
        self.assertNotIn('Laelaps AI', [c for _, c in kinds])  # answered: a Replied event came after

    def test_a_booking_invite_and_an_offer(self):
        rows = [row('a', 'Acme', 'SRE', stage='Screening'), row('b', 'Zeta', 'SRE', stage='Offer')]
        events = [event('a', 'Reply received', '2026-09-28T08:00:00Z', 'Pick a time that works for you'),
                  event('b', 'Offer', '2026-09-28T09:00:00Z', 'CHF 160k')]
        self.assertEqual([i['kind'] for i in focus.build(rows, events, now=NOW)['items']][:2], ['offer', 'book'])

    def test_the_daily_target_counts_todays_applications(self):
        rows = [row('a', 'A', 'x', applied='2026-09-28'), row('b', 'B', 'y', applied='2026-09-20'), row('c', 'C', 'z', applied='2026-09-20')]
        events = [event('b', 'Applied', '2026-09-28T09:00:00+02:00')]
        result = focus.build(rows, events, target=3, now=NOW)
        self.assertEqual(result['today'], {'applied': 2, 'target': 3, 'kits_ready': 0})
        apply = next(i for i in result['items'] if i['kind'] == 'apply')
        self.assertEqual(apply['title'], 'Apply to 1 more job today')
        self.assertFalse(any(i['kind'] == 'apply' for i in focus.build(rows, events, target=2, now=NOW)['items']))
        waiting = next(i for i in result['items'] if i['kind'] == 'waiting')
        self.assertIn('2 applications waiting', waiting['title'])  # b and c: applied 8 days ago, no human reply

    def test_after_an_interview_review_it_and_a_quiet_screening_gets_a_nudge(self):
        rows = [row('a', 'Acme', 'SRE', stage='Interviewing', interview='2026-09-27T14:00:00+02:00'),
                row('b', 'Beta', 'SRE', stage='Screening')]
        events = [event('b', 'Screening', '2026-09-22T10:00:00Z')]
        kinds = [i['kind'] for i in focus.build(rows, events, now=NOW)['items']]
        self.assertEqual(kinds[:2], ['review', 'nudge'])
        saved = [{'properties': {'Date': {'type': 'date', 'date': {'start': '2026-09-27'}},
                                 'Application': {'type': 'relation', 'relation': [{'id': 'a'}]}}}]
        self.assertNotIn('review', [i['kind'] for i in focus.build(rows, events, saved, now=NOW)['items']])

    def test_rejected_jobs_leave_the_list_but_their_lesson_is_shown(self):
        rows = [row('a', 'Canonical', 'SRE', stage='Rejected', Rejection_lesson='Lead with Python.',
                    Rejection_reason={'type': 'select', 'select': {'name': 'Hard skills'}})]
        events = [event('a', 'Reply received', '2026-09-28T08:00:00Z')]
        items = focus.build(rows, events, target=0, now=NOW)['items']
        self.assertEqual([i['kind'] for i in items], ['learn'])
        self.assertIn('Hard skills. Lead with Python.', items[0]['detail'])

    def test_the_funnel_counts_each_step_from_the_same_rows(self):
        rows = [row('a', 'A', 'x', stage='Rejected'), row('b', 'B', 'y', stage='Screening'), row('c', 'C', 'z', stage='Kit ready', applied=None)]
        events = [event('a', 'Reply received', '2026-09-27T10:00:00Z')]
        steps = {s['step']: s['reached'] for s in focus.build(rows, events, now=NOW)['funnel']['steps']}
        self.assertEqual([steps[k] for k in ('📝 Prepared', '📨 Applied', '💬 Human reply', '📞 Screening')], [3, 2, 2, 1])

    def test_reminder_only_when_worth_it(self):
        calm = {'today': {'applied': 30, 'target': 30, 'kits_ready': 0}, 'items': []}
        self.assertEqual(focus.reminder(calm, now=NOW), '')
        busy = {'today': {'applied': 4, 'target': 30, 'kits_ready': 6},
                'items': [{'kind': 'reply', 'company': 'Duvo.ai', 'priority': 1}]}
        text = focus.reminder(busy, now=NOW)
        self.assertIn('1 person waits for your answer: Duvo.ai', text)
        self.assertIn('4/30 applications today; 6 kits ready', text)


if __name__ == '__main__':
    unittest.main()
