import tempfile
import unittest
from datetime import date
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.notion import client as applications
from src import daily, digest
from src import store as job_store


def row(url, stage):
    return {'properties': {'Job URL': {'url': url}, 'Stage': {'select': {'name': stage} if stage else None}}}


class FakeTracker(applications.Tracker):
    """Records Notion API calls instead of making them."""
    def __init__(self, pages=()):
        super().__init__('token', 'db')
        self.pages, self.created, self.patched = list(pages), [], []

    def _request(self, method, path, body=None):
        if path.endswith('/query'):
            wanted = (body.get('filter') or {}).get('url', {}).get('equals')
            results = [p for p in self.pages if wanted in (None, p['properties']['Job URL']['url'])]
            return {'results': results, 'has_more': False}
        if method == 'PATCH':
            page = next(p for p in self.pages if p.get('id') == path.split('/')[-1])
            page['properties']['Stage'] = {'select': body['properties']['Stage']['select']}
            self.patched.append(body)
            return page
        self.created.append(body)
        page = {'id': f'row{len(self.created)}', 'url': 'https://notion.test/page', 'properties': {'Job URL': {'url': body['properties']['Job URL']['url']},
                                                                  'Stage': {'select': body['properties']['Stage']['select']}}}
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


class ButtonStageTests(unittest.TestCase):
    job = {'title': 'SRE', 'company': 'Example', 'location': 'Zurich', 'url': 'https://x.test/9'}

    def test_save_then_apply_updates_but_dismiss_never_overwrites_an_application(self):
        tracker = FakeTracker()
        self.assertEqual(tracker.mark(self.job, 'Saved')[1], 'created')
        self.assertNotIn('Applied on', tracker.created[0]['properties'])
        self.assertEqual(tracker.url_stages(), {'https://x.test/9': 'Saved'})
        self.assertEqual(tracker.hidden_urls(), set())          # saved jobs stay in digests
        self.assertEqual(tracker.mark(self.job, 'Applied')[1], 'updated')
        self.assertIn('Applied on', tracker.patched[0]['properties'])
        self.assertEqual(tracker.mark(self.job, 'Dismissed')[1], 'unchanged')
        self.assertEqual(tracker.url_stages(), {'https://x.test/9': 'Applied'})

    def test_dismissed_jobs_are_hidden(self):
        tracker = FakeTracker()
        tracker.mark(self.job, 'Dismissed')
        self.assertEqual(tracker.hidden_urls(), {'https://x.test/9'})


class KitReadyStageTests(unittest.TestCase):
    def test_kit_ready_never_overrides_a_star_or_a_later_stage(self):
        job = {'title': 'SRE', 'company': 'Acme', 'location': '', 'url': 'https://x.test/k'}
        tracker = FakeTracker()
        self.assertEqual(tracker.mark(job, 'Kit ready')[1], 'created')
        self.assertEqual(tracker.mark(job, 'Saved')[1], 'updated')       # owner stars it
        self.assertEqual(tracker.mark(job, 'Kit ready')[1], 'unchanged')  # redraft keeps the star
        self.assertEqual(tracker.mark(job, 'Applied')[1], 'updated')
        self.assertEqual(tracker.mark(job, 'Kit ready')[1], 'unchanged')
        self.assertIn('Kit ready', applications.VISIBLE_STAGES)


class TrackedJobFallbackTests(unittest.TestCase):
    """A job tracked in Notion but missing from the crawl's SQLite must still be markable/preparable."""
    def test_apply_falls_back_to_the_notion_row(self):
        url = 'https://job-boards.greenhouse.io/acme/jobs/42'
        page = row(url, 'Saved')
        page['id'] = 'row-42'
        page['properties']['Job'] = {'title': [{'plain_text': 'Staff SRE'}]}
        page['properties']['Company'] = {'rich_text': [{'plain_text': 'Acme'}]}
        tracker = FakeTracker([page])
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(daily.ats, 'posting', return_value=None):
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                self.assertIsNone(daily.find_job(db, url))
                job = daily.tracked_job(url, tracker)
                self.assertEqual((job['title'], job['company'], job['id']), ('Staff SRE', 'Acme', None))
                self.assertEqual(daily.tracked_job(applications.job_code(url), tracker)['url'], url)
                self.assertIn('✅ Marked applied', daily.apply_message(db, url, tracker))
                self.assertIsNone(daily.tracked_job('https://x.test/untracked', tracker))

    def test_falls_back_to_job_matches_when_the_applications_row_is_gone(self):
        url = 'https://jobs.ashbyhq.com/acme/abc-123'
        match = {'properties': {'Job URL': {'url': url}, 'Job': {'title': [{'plain_text': 'Platform SRE'}]},
                                'Company': {'rich_text': [{'plain_text': 'Acme'}]}}}
        tracker = FakeTracker()
        from unittest import mock
        with mock.patch.object(daily.ats, 'posting', return_value=None), \
                mock.patch.object(FakeTracker, 'query_database', lambda self, db, f=None: [match]):
            job = daily.tracked_job(url, tracker)
            self.assertEqual((job['title'], job['company'], job['url']), ('Platform SRE', 'Acme', url))
            self.assertEqual(daily.tracked_job(applications.job_code(url), tracker)['url'], url)


class DigestIntegrationTests(unittest.TestCase):
    def test_applied_jobs_are_hidden_and_apply_command_works(self):
        report = {'jobs': [{'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich',
                            'url': f'https://x.test/{i}'} for i in range(3)]}
        with tempfile.TemporaryDirectory() as tmp:
            with job_store.connect(Path(tmp) / 'jobs.sqlite') as db:
                job_store.import_watch_report(db, report)
                tracker = FakeTracker()
                code = applications.job_code('https://x.test/1')
                _, _, keyboards = digest.build_digest(db)
                buttons = [b for row in keyboards[0]['inline_keyboard'] for b in row]
                self.assertTrue(any(b['callback_data'].startswith(f'pick:{code}:') for b in buttons))
                self.assertEqual([b['text'] for b in buttons], ['1', '2', '3'])
                self.assertIn('✅ Marked applied', daily.apply_message(db, code, tracker))
                self.assertIn('Already tracked', daily.apply_message(db, code, tracker))
                self.assertIn('No job with code', daily.apply_message(db, 'deadbeef', tracker))
                self.assertIn('⭐ Saved', daily.apply_message(db, applications.job_code('https://x.test/0'), tracker, 'saved'))
                stages = tracker.url_stages()
                saved = frozenset(u for u, s in stages.items() if s == 'Saved')
                message = digest.format_digest(db, hidden_urls=frozenset(tracker.hidden_urls()), saved_urls=saved)
                self.assertIn('1. ⭐ <a href="https://x.test/0"', message)  # saved job ranks first, starred
        self.assertNotIn('https://x.test/1"', message)
        self.assertIn('https://x.test/0"', message)
        self.assertIn('1 applied', message)


if __name__ == '__main__':
    unittest.main()
