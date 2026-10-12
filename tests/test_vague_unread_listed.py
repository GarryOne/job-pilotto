"""A job whose location is only a country and whose posting could not be read (#323, owner 12 Oct 2026): it can be neither placed nor scored,
so every place that lists jobs shows it, unscored, its place unclear; never hidden as "waiting", never closed silently."""
import tempfile
import unittest
from pathlib import Path

from src import daily, desktop, digest
from src import store as job_store
from src.sources import feeds

URL = 'https://example.test/vague-unread'


class VagueUnreadListedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = job_store.connect(Path(self.tmp.name) / 'jobs.sqlite')
        job_store.import_watch_report(self.db, {'jobs': [{'company': 'Coop', 'id': '1', 'title': 'Site Reliability Engineer',
                                                          'location': 'Switzerland', 'url': URL, 'description': ''}]})
        feeds.PLACED, feeds.READ = {'switzerland': 'out:vague'}, {}

    def tearDown(self):
        feeds.PLACED = feeds.READ = None
        self.db.close()
        self.tmp.cleanup()

    def test_setup_is_the_stuck_case(self):
        job = job_store.digest_jobs(self.db, limit=10, only_new=False)[0]
        self.assertEqual((feeds.place_of(job), job.get('description') or ''), ('vague', ''), 'positive control: vague and unreadable')
        self.assertEqual(daily.to_score(self.db, set()), [], 'not scored: its place cannot be told')
        self.assertTrue(feeds.keep_open(job), 'never closed silently')

    def test_every_job_list_shows_it(self):
        # The class: each place that lists found jobs. Focus lists applications only (src/focus.py), never found jobs.
        listers = {
            'Jobs list (Notion store)': lambda: desktop.jobs(self.db, notion_jobs=[], hide_unscored=True)['jobs'],
            'Jobs list (no store list)': lambda: desktop.jobs(self.db, hide_unscored=True)['jobs'],
            'Telegram digest': lambda: [{'url': URL}] if URL in ''.join(digest.build_digest(self.db, seed=1)[0]) else [],
        }
        for name, listed in listers.items():
            with self.subTest(name):
                self.assertIn(URL, [row.get('url') for row in listed()])

    def test_the_jobs_list_says_why_it_is_unscored(self):
        result = desktop.jobs(self.db, notion_jobs=[], hide_unscored=True)
        row = next(row for row in result['jobs'] if row['url'] == URL)
        self.assertIsNone(row['fit'])
        self.assertTrue(row['place_unclear'], 'the app says its place is unclear and the posting could not be read')
        self.assertEqual(result['waiting'], 0, 'not counted as waiting: no refresh will score it')

    def test_a_readable_vague_job_still_waits_for_its_reading(self):
        self.db.execute("UPDATE jobs SET description = 'At our Geneva site.' WHERE url = ?", (URL,))
        result = desktop.jobs(self.db, notion_jobs=[], hide_unscored=True)
        self.assertNotIn(URL, [row['url'] for row in result['jobs']])
        self.assertEqual(result['waiting'], 1)


if __name__ == '__main__':
    unittest.main()
