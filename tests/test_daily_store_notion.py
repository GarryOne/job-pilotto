"""The daily run's store reads and writes on the Notion stand-in (src/daily_helpers.py): what a Notion user had before the
engine went through the store. The same calls on the memory store: tests/test_applications.py."""
import unittest
from unittest import mock

from src import daily
from src.notion import client as notion
from tests import test_store_notion as stand_in


@unittest.skipUnless(stand_in.shutil.which('node'), 'node runs the Notion stand-in')
class TrackedJobOnNotionTests(unittest.TestCase):
    setUpClass = classmethod(stand_in.NotionStoreTests.setUpClass.__func__)
    tearDownClass = classmethod(stand_in.NotionStoreTests.tearDownClass.__func__)
    make = stand_in.NotionStoreTests.make

    def setUp(self):
        self.s = self.make()
        posting = mock.patch.object(daily.ats, 'posting', return_value=None)
        posting.start()
        self.addCleanup(posting.stop)

    def test_the_job_tracker_row_by_url_and_by_code(self):
        url = 'https://job-boards.greenhouse.io/acme/jobs/42'
        self.s.applications.create({'url': url, 'title': 'Staff SRE', 'company': 'Acme'}, 'Saved')
        job = daily.tracked_job(url, self.s)
        self.assertEqual((job['title'], job['company'], job['url']), ('Staff SRE', 'Acme', url))
        self.assertEqual(daily.tracked_job(notion.job_code(url), self.s)['url'], url)
        self.assertIsNone(daily.tracked_job('https://x.test/untracked', self.s))

    def test_the_job_matches_row_when_there_is_no_tracker_row(self):
        url = 'https://jobs.ashbyhq.com/acme/abc-123'
        self.s.matches.upsert({'url': url, 'title': 'Platform SRE', 'company': 'Acme', 'location': 'Zurich'})
        job = daily.tracked_job(notion.job_code(url), self.s)
        self.assertEqual((job['title'], job['company'], job['location']), ('Platform SRE', 'Acme', 'Zurich'))


if __name__ == '__main__':
    unittest.main()
