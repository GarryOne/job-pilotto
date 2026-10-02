"""The engine's view of the service: a stable random install id and the private playbook, failing soft."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import service  # noqa: E402


class InstallIdTest(unittest.TestCase):
    def test_the_shared_id_wins_and_a_random_one_is_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'install_id'
            self.assertEqual(service.install_id(path, {'JOB_PILOTTO_INSTALL_ID': 'shared-install-1'}), 'shared-install-1')
            self.assertFalse(path.exists())
            first = service.install_id(path, {})
            self.assertRegex(first, r'^[0-9a-f]{24}$')
            self.assertEqual(service.install_id(path, {}), first)            # kept for the next run
            self.assertNotEqual(service.install_id(Path(tmp) / 'other', {'JOB_PILOTTO_INSTALL_ID': 'bad id'}), 'bad id')


class PlaybookTest(unittest.TestCase):
    def test_it_asks_with_the_token_for_one_board(self):
        seen = {}
        def post(url, body):
            seen['post'] = (url, body)
            return {'token': 'tok'}
        def get(url, headers):
            seen['get'] = (url, headers)
            return {'ok': True, 'board': 'ashby', 'text': 'ashby notes'}
        text = service.playbook('Ashby', base='https://x.test/', install='install-12345', post=post, get=get)
        self.assertEqual(text, 'ashby notes')
        self.assertEqual(seen['post'], ('https://x.test/api/install-token', {'install': 'install-12345'}))
        self.assertEqual(seen['get'], ('https://x.test/api/playbook?board=ashby', {'Authorization': 'Bearer tok', 'X-Install-Id': 'install-12345'}))

    def test_any_trouble_means_no_notes(self):
        def broken(url, *args):
            raise OSError('offline')
        self.assertEqual(service.playbook('lever', base='https://x.test', install='install-12345', post=broken), '')
        self.assertEqual(service.playbook('lever', base='https://x.test', install='install-12345', post=lambda u, b: {}), '')
        self.assertEqual(service.playbook('lever', base='https://x.test', install='install-12345', post=lambda u, b: {'token': 't'}, get=broken), '')


if __name__ == '__main__':
    unittest.main()
