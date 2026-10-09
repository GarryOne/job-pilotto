"""Your answer about an email: "Is this about …?" (src/ai/reassign.py)."""
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


from tests.mail_fakes import APPS_DB, SCHEMA_COLUMNS  # noqa: E402 (after the path setup)


class FakeTracker:
    database_id = APPS_DB

    def __init__(self, pages):
        self.pages = {p['id']: p for p in pages}
        self.updates = []

    def _request(self, method, path, body=None):  # a page as Notion returns it: with the database it sits in
        if path.startswith('databases/'):
            return {'properties': {name: {} for name in SCHEMA_COLUMNS['apps'] | SCHEMA_COLUMNS['events']}}
        page = self.pages[path.split('/')[1]]
        return {'parent': {'database_id': self.database_id}, **page}

    def find(self, url):
        return next((p for p in self.pages.values() if (p['properties'].get('Job URL') or {}).get('url') == url), None)

    def update_page(self, page_id, properties):
        self.updates.append((page_id, properties))
        page = self.pages.get(page_id)
        if page:
            for name, value in properties.items():
                kind = next(iter(value))
                page['properties'][name] = {'type': kind, kind: value[kind]}
        return page or {'id': page_id, 'properties': {}}


class MoveTests(unittest.TestCase):
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
        from tests.test_focus import from_notion  # the rows the Gmail check writes, as the notion store reads them
        hux = from_notion(job('hux', '', 'Principal SRE', via='Huxley'))
        asked = from_notion(event('q', 'Interview scheduled', suggested='https://x.test/hux'), 'events')
        items = focus.build([hux], [asked], target=0, now=NOW)['items']
        [ask] = [i for i in items if i['kind'] == 'which_job']
        self.assertEqual(ask['title'], 'Is this email about Huxley — Principal SRE?')
        self.assertEqual((ask['event_id'], ask['suggested_url'], ask['badge']), ('q', 'https://x.test/hux', 'Which job?'))
        answered = from_notion(event('q', 'Interview scheduled', application='hux'), 'events')
        self.assertFalse([i for i in focus.build([hux], [answered], target=0, now=NOW)['items'] if i['kind'] == 'which_job'])


if __name__ == '__main__':
    unittest.main()
