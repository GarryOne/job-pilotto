"""Your answer about an email: "Is this about …?" and "Not this job" (src/ai/reassign.py)."""
import json
import unittest
from datetime import datetime, timezone

from src import focus
from src.ai import reassign

NOW = datetime(2026, 9, 29, 13, 0, tzinfo=timezone.utc)


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def job(page_id, company, title, stage='Screening', via='', interview=None):
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': {
        'Company': text(company), 'Via': text(via), 'Job': {'type': 'title', 'title': [{'plain_text': title}]},
        'Stage': {'type': 'select', 'select': {'name': stage}}, 'Contact': text(''), 'Feedback status': text(''),
        'Next interview': {'type': 'date', 'date': {'start': interview} if interview else None},
        'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}}


def event(event_id, kind, application=None, changes=None, suggested=''):
    return {'id': event_id, 'properties': {
        'Kind': {'type': 'select', 'select': {'name': kind}}, 'Note': text('Teams call (email: "Connect Igor / Jaya - SRE")'),
        'At': {'type': 'date', 'date': {'start': '2026-09-29T14:35:00+02:00'}}, 'Source ID': text('h1'),
        'Application': {'type': 'relation', 'relation': [{'id': application}] if application else []},
        'Needs you': {'type': 'checkbox', 'checkbox': not application},
        'Suggested job': {'type': 'url', 'url': suggested or None},
        'Changes': text(json.dumps(changes or {}))}}


class FakeTracker:
    database_id = 'apps'

    def __init__(self, pages):
        self.pages = {p['id']: p for p in pages}
        self.updates = []

    def _request(self, method, path, body=None):
        return self.pages[path.split('/')[1]]

    def find(self, url):
        return next((p for p in self.pages.values() if (p['properties'].get('Job URL') or {}).get('url') == url), None)

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))
        page = self.pages.get(page_id)
        if page:
            for name, value in properties.items():
                kind = next(iter(value))
                page['properties'][name] = {'type': kind, kind: value[kind]}


class MoveTests(unittest.TestCase):
    def test_not_this_job_puts_the_wrong_job_back_and_moves_the_email(self):
        # 29 Sep 2026: Huxley's invite had moved AG Talent's pitch to Interview scheduled.
        ag = job('ag', '', 'Senior DevOps Engineer', stage='Interview scheduled', via='AG Talent',
                 interview='2026-09-30T06:30:00.000+00:00')
        hux = job('hux', '', 'Principal SRE', stage='Screening', via='Huxley')
        wrong = event('ev', 'Interview scheduled', 'ag', {
            'fields': {'Stage': ['Screening', 'Interview scheduled'], 'Next interview': [None, '2026-09-30T08:30:00+02:00']},
            'interview_at': '2026-09-30T08:30:00+02:00', 'from': 'j.nejati@huxley.com', 'subject': 'Connect Igor / Jaya - SRE'})
        tracker = FakeTracker([ag, hux, wrong])
        result = reassign.move(tracker, 'ev', 'https://x.test/hux', now=NOW)
        self.assertTrue(result['ok'], result)
        ag_back = {k: v for p, u in tracker.updates if p == 'ag' for k, v in u.items()}
        self.assertEqual(ag_back, {'Stage': {'select': {'name': 'Screening'}}, 'Next interview': {'date': None}})
        self.assertEqual(hux['properties']['Stage']['select']['name'], 'Interview scheduled')
        moved = [u for p, u in tracker.updates if p == 'ev'][-1]
        self.assertEqual(moved['Application'], {'relation': [{'id': 'hux'}]})
        self.assertEqual(moved['Needs you'], {'checkbox': False})

    def test_a_field_changed_later_is_left_alone(self):
        ag = job('ag', '', 'Senior DevOps Engineer', stage='Offer', via='AG Talent')
        wrong = event('ev', 'Interview scheduled', 'ag', {'fields': {'Stage': ['Screening', 'Interview scheduled']}})
        tracker = FakeTracker([ag, wrong])
        reassign.move(tracker, 'ev', 'none', now=NOW)
        self.assertNotIn('ag', [p for p, _ in tracker.updates])  # you moved it on since: not undone
        self.assertEqual([u for p, u in tracker.updates if p == 'ev'][-1]['Application'], {'relation': []})

    def test_answering_is_this_about(self):
        hux = job('hux', '', 'Principal SRE', via='Huxley')
        question = event('q', 'Interview scheduled', changes={'interview_at': '2026-09-30T08:30:00+02:00'},
                         suggested='https://x.test/hux')
        tracker = FakeTracker([hux, question])
        self.assertTrue(reassign.move(tracker, 'q', 'https://x.test/hux', now=NOW)['ok'])
        self.assertEqual(hux['properties']['Next interview']['date']['start'], '2026-09-30T08:30:00+02:00')
        fresh = event('q2', 'Interview scheduled', suggested='https://x.test/hux')
        self.assertIs(reassign.move(FakeTracker([fresh]), 'q2', 'https://x.test/gone', now=NOW)['ok'], False)


class FocusQuestionTests(unittest.TestCase):
    def test_an_open_question_is_asked_with_the_likeliest_job(self):
        hux = job('hux', '', 'Principal SRE', via='Huxley')
        items = focus.build([hux], [event('q', 'Interview scheduled', suggested='https://x.test/hux')], target=0, now=NOW)['items']
        [ask] = [i for i in items if i['kind'] == 'which_job']
        self.assertEqual(ask['title'], 'Is this email about Huxley — Principal SRE?')
        self.assertEqual((ask['event_id'], ask['suggested_url'], ask['badge']), ('q', 'https://x.test/hux', 'Which job?'))
        answered = event('q', 'Interview scheduled', application='hux')
        self.assertFalse([i for i in focus.build([hux], [answered], target=0, now=NOW)['items'] if i['kind'] == 'which_job'])


if __name__ == '__main__':
    unittest.main()
