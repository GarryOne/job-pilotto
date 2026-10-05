"""The terminal follows the Desktop App: its Notion IDs and data folders, unless the environment says otherwise."""
import io
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

from src import paths


def app(settings, folders=('data', 'config')):
    folder = Path(tempfile.mkdtemp())
    (folder / 'settings.json').write_text(json.dumps(settings))
    for name in folders:
        (folder / name).mkdir()
    return folder


class FollowAppTests(unittest.TestCase):
    def follow(self, env, folder):
        with mock.patch.dict(sys.modules, {'unittest': None}):  # the guard for tests themselves, lifted here
            del sys.modules['unittest']
            return paths.follow_app(env, folder)

    def test_ids_and_folders_come_from_the_app(self):
        folder = app({'setupDone': True, 'notionIds': {'NOTION_APPLICATIONS_DB': 'new-apps', 'NOTION_MATCHES_DB': 'new-matches'}})
        env = {'NOTION_MATCHES_DB': 'new-matches'}  # the same ID in .env is fine
        self.follow(env, folder)
        self.assertEqual(env['NOTION_APPLICATIONS_DB'], 'new-apps')
        self.assertEqual(env['JOB_PILOTTO_DATA_DIR'], str(folder / 'data'))
        self.assertEqual(env['JOB_PILOTTO_CONFIG_DIR'], str(folder / 'config'))

    def test_env_pointing_at_another_workspace_keeps_that_run_separate(self):
        folder = app({'setupDone': True, 'notionIds': {'NOTION_APPLICATIONS_DB': 'new-apps', 'NOTION_MATCHES_DB': 'new-matches'}})
        env = {'NOTION_MATCHES_DB': 'test-matches'}
        self.assertEqual(self.follow(env, folder), {})
        self.assertEqual(env, {'NOTION_MATCHES_DB': 'test-matches'})  # no app IDs, no app job cache: never mixed

    def test_nothing_taken_when_the_app_runs_it_is_switched_off_or_not_set_up(self):
        folder = app({'setupDone': True, 'notionIds': {'NOTION_APPLICATIONS_DB': 'x'}})
        for env in ({'JOB_PILOTTO_NO_DOTENV': '1'}, {'JOB_PILOTTO_FOLLOW_APP': '0'}):
            self.assertEqual(self.follow(dict(env), folder), {})
        self.assertEqual(self.follow({}, app({'setupDone': False, 'notionIds': {'NOTION_APPLICATIONS_DB': 'x'}})), {})
        self.assertEqual(self.follow({}, Path(tempfile.mkdtemp())), {})  # no app on this computer

    def test_tests_never_follow_the_app(self):
        folder = app({'setupDone': True, 'notionIds': {'NOTION_APPLICATIONS_DB': 'x'}})
        self.assertEqual(paths.follow_app({}, folder), {})


class RunLockTests(unittest.TestCase):
    def test_a_second_run_waits_for_the_first(self):
        folder = tempfile.mkdtemp()
        order, waited = [], threading.Event()
        with paths.run_lock(folder):
            second = threading.Thread(target=lambda: paths.run_lock(folder, on_wait=waited.set, poll=0.05).__enter__() or order.append('second'))
            second.start()
            self.assertTrue(waited.wait(2))
            order.append('first done')
        second.join(2)
        self.assertEqual(order, ['first done', 'second'])

    def test_a_waiting_run_says_what_it_waits_for_and_since_when(self):
        import io
        from contextlib import redirect_stderr
        folder = tempfile.mkdtemp()
        out, done = io.StringIO(), threading.Event()

        def wait():
            with redirect_stderr(out), paths.run_lock(folder, poll=0.05):
                done.set()
        with paths.run_lock(folder, label='daily scheduled'):
            holder = json.loads((Path(folder) / 'run.lock').read_text())
            self.assertEqual((holder['pid'], holder['label']), (os.getpid(), 'daily scheduled'))
            line = paths._waiting_line(holder, time.time() - 125)
            self.assertIn('waiting for a daily scheduled run started', line)
            self.assertIn(f"(pid {os.getpid()})", line)
            self.assertIn('waited 2 min', line)
            thread = threading.Thread(target=wait)
            thread.start()
            time.sleep(0.3)
            self.assertFalse(done.is_set())
        thread.join(3)
        self.assertTrue(done.is_set())
        self.assertIn('Another Job Pilotto search is running (app or terminal): waiting for a daily scheduled run', out.getvalue())

    def test_a_run_gives_up_on_a_holder_that_never_lets_go(self):
        folder = tempfile.mkdtemp()
        with paths.run_lock(folder, label='daily scheduled'):
            with redirect_stderr(io.StringIO()), self.assertRaises(paths.LockTimeout) as caught:
                paths.run_lock(folder, poll=0.05, wait_max=0.2).__enter__()
        self.assertIn('waiting for a daily scheduled run', str(caught.exception))
        self.assertIn(f'pid {os.getpid()}', str(caught.exception))
        self.assertIn('looks stuck', str(caught.exception))

    def test_a_lock_from_before_the_holder_wrote_anything_still_reads_well(self):
        self.assertIn('waiting for another run;', paths._waiting_line({}, time.time()))


if __name__ == '__main__':
    unittest.main()
