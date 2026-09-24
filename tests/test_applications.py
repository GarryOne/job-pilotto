import tempfile
import unittest
from datetime import date
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import applications
import daily
import job_store


def row(url, stage):
    return {'properties': {'Job URL': {'url': url}, 'Stage': {'select': {'name': stage} if stage else None}}}


class FakeTracker(applications.Tracker):
    """Records Notion API calls instead of making them."""
    def __init__(self, pages=()):
        super().__init__('token', 'db')
        self.pages, self.created = list(pages), []

    def _request(self, method, path, body=None):
        if path.endswith('/query'):
            wanted = (body.get('filter') or {}).get('url', {}).get('equals')
            results = [p for p in self.pages if wanted in (None, p['properties']['Job URL']['url'])]
            return {'results': results, 'has_more': False}
        self.created.append(body)
        page = {'url': 'https://notion.test/page', 'properties': {'Job URL': {'url': body['properties']['Job URL']['url']},
                                                                  'Stage': {'select': {'name': 'Applied'}}}}
        self.pages.append(page)
        return page


class TrackerTests(unittest.TestCase):
    def test_job_code_is_stable_and_short(self):
        self.assertEqual(applications.job_code('https://x.test/1'), applications.job_code(' https://x.test/1 '))
        self.assertEqual(len(applications.job_code('https://x.test/1')), 8)

    def test_saved_jobs_stay_visible_everything_else_is_hidden(self):
        tracker = FakeTracker([row('https://x.test/applied', 'Applied'), row('https://x.test/saved', 'Saved'),
                               row('https://x.test/rejected', 'Rejected'), row('https://x.test/blank', None)])
        self.assertEqual(tracker.hidden_urls(),
                         {'https://x.test/applied', 'https://x.test/rejected', 'https://x.test/blank'})

    def test_mark_applied_creates_once(self):
        tracker = FakeTracker()
        job = {'title': 'SRE', 'company': 'Example', 'location': 'Zurich', 'url': 'https://x.test/1',
               'posted_at': '2026-09-20T08:00:00Z', 'first_seen_at': '2026-09-24T00:00:00+00:00'}
        _, created = tracker.mark_applied(job, today=date(2026, 9, 24))
        self.assertTrue(created)
        props = tracker.created[0]['properties']
        self.assertEqual(props['Posted']['date']['start'], '2026-09-20')
        self.assertEqual(props['Applied on']['date']['start'], '2026-09-24')
        self.assertEqual(props['Stage']['select']['name'], 'Applied')
        _, created = tracker.mark_applied(job)
        self.assertFalse(created)
        self.assertEqual(len(tracker.created), 1)


class DigestIntegrationTests(unittest.TestCase):
    def test_applied_jobs_are_hidden_and_apply_command_works(self):
        report = {'jobs': [{'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich',
                            'url': f'https://x.test/{i}'} for i in range(3)]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                tracker = FakeTracker()
                code = applications.job_code('https://x.test/1')
                _, _, keyboards = daily.build_digest(db)
                buttons = [b for row in keyboards[0]['inline_keyboard'] for b in row]
                self.assertIn(f'apply:{code}', [b['callback_data'] for b in buttons])
                self.assertTrue(all(b['text'].startswith('✅ ') for b in buttons))
                self.assertIn('✅ Marked applied', daily.apply_message(db, code, tracker))
                self.assertIn('Already tracked', daily.apply_message(db, code, tracker))
                self.assertIn('No job with code', daily.apply_message(db, 'deadbeef', tracker))
                message = daily.format_digest(db, hidden_urls=frozenset(tracker.hidden_urls()))
        self.assertNotIn('https://x.test/1"', message)
        self.assertIn('https://x.test/0"', message)
        self.assertIn('1 applied', message)


if __name__ == '__main__':
    unittest.main()
