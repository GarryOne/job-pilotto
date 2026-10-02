"""JOB_PILOTTO_FIXTURE_DIR: feeds come from a folder, never the network (the end-to-end journey's deterministic jobs)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import employer_index
from src.sources import ats


class FixtureFeedsTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        (root / 'routes.json').write_text(json.dumps({'/boards/acme/jobs': 'acme.json'}))
        (root / 'acme.json').write_text(json.dumps({'jobs': [
            {'id': 7, 'title': 'Senior SRE', 'location': {'name': 'Zurich, Switzerland'}, 'absolute_url': 'https://boards.example.test/acme/7',
             'content': '<p>Run Kubernetes.</p>', 'updated_at': '2026-10-01'}]}))
        patch = mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': self.folder.name})
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(self.folder.cleanup)

    def test_a_routed_feed_is_read_from_the_folder(self):
        jobs = ats.fetch('greenhouse', 'acme')
        self.assertEqual([(j['title'], j['location']) for j in jobs], [('Senior SRE', 'Zurich, Switzerland')])

    def test_a_feed_with_no_route_fails_like_an_unreachable_one_and_never_goes_online(self):
        with mock.patch('urllib.request.urlopen', side_effect=AssertionError('went online')):
            with self.assertRaises(OSError):
                ats.fetch('greenhouse', 'unknown')

    def test_the_employer_index_is_not_downloaded(self):
        with mock.patch('urllib.request.urlopen', side_effect=AssertionError('went online')):
            self.assertEqual(employer_index.load(cache=Path(self.folder.name) / "idx.json"), [])


if __name__ == '__main__':
    unittest.main()


class DiscoveryTest(unittest.TestCase):
    def test_the_jobs_ch_crawl_stays_offline_in_fixture_mode(self):
        from src.sources import boards
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': '/nowhere'}), mock.patch.object(boards, 'urlopen', side_effect=AssertionError('went online')), \
                mock.patch('sys.argv', ['discover']):
            self.assertEqual(boards.main(), 0)
