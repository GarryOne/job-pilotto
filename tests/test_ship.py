"""tools/ship.sh, the one-command landing of a worktree (6 Oct 2026), 1 of 2: run on a throwaway origin with a stub push hook: rebase over a moved main, the hook's refusal, the main checkout update (and its skip on overlapping edits), the worktree cleanup, the log and its marker. Fixture: ship_fixture.py."""
import os
import re
import signal
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.ship_fixture import *   # noqa: F401,F403 (git, ROOT: the fixture)
from tests.ship_fixture import ShipFixture


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipTest(ShipFixture):
    def test_rebases_over_a_moved_main_pushes_updates_the_checkout_and_keeps_the_worktree(self):
        self.change(self.other, 'theirs.txt', 'x\n', 'Another session pushed')
        git(self.other, 'push', '-q', 'origin', 'main')
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.ship()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(git(self.origin, 'log', '--format=%s', 'main').splitlines(), ['My change', 'Another session pushed', 'Start'])
        self.assertTrue((self.main / 'mine.txt').exists() and (self.main / 'theirs.txt').exists(), 'the main checkout is up to date')
        self.assertTrue(self.tree.exists(), 'the worktree is kept (owner, 11 Oct 2026; tools/worktree.sh prune removes old landed ones)')
        self.assertIn('topic', git(self.main, 'branch', '--list'))

    def test_remove_gives_the_old_behaviour(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        self.assertEqual(self.ship('--remove').returncode, 0)
        self.assertFalse(self.tree.exists(), '--remove removes the worktree')
        self.assertNotIn('topic', git(self.main, 'branch', '--list'))

    def test_the_hooks_refusal_stops_the_push(self):
        self.change(self.tree, 'tools/pre-push-check.sh', '#!/bin/sh\necho "Push blocked: tests failed in desktop" >&2\nexit 2\n', 'Hook that refuses')
        result = self.ship()
        self.assertEqual(result.returncode, 2)
        self.assertIn('Push blocked', result.stderr)
        self.assertEqual(git(self.origin, 'log', '--format=%s', 'main'), 'Start')
        self.assertTrue(self.tree.exists())

    def test_flags_reach_the_hook_as_the_push_command_it_reads(self):
        self.change(self.tree, 'tools/pre-push-check.sh', f'#!/bin/sh\ncat > {self.tmp}/payload.json\n', 'Hook that records')
        self.assertEqual(self.ship('--full', '--fix', '--keep').returncode, 0)
        payload = (self.tmp / 'payload.json').read_text()
        self.assertIn('PUSH_FULL=1', payload)
        self.assertIn('CI_RED_OK=1', payload)
        self.assertIn('git push origin topic:main', payload)
        self.assertTrue(self.tree.exists(), '--keep leaves the worktree')

    def test_uncommitted_edits_to_a_pushed_file_keep_the_main_checkout_as_it_is(self):
        self.change(self.tree, 'a.txt', 'changed\n', 'Change a')
        (self.main / 'a.txt').write_text('another session is editing this\n')
        result = self.ship()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('NOT updating the main checkout', result.stderr)
        self.assertEqual((self.main / 'a.txt').read_text(), 'another session is editing this\n')
        self.assertIn('Change a', git(self.origin, 'log', '--format=%s', 'main'))

    def test_refuses_the_main_checkout_and_uncommitted_changes(self):
        result = subprocess.run(['bash', str(self.main / 'tools' / 'ship.sh')], cwd=self.main, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        (self.tree / 'a.txt').write_text('dirty\n')
        self.assertEqual(self.ship().returncode, 2)

    def test_a_conflict_stops_with_nothing_pushed_and_no_half_finished_rebase(self):
        self.change(self.other, 'a.txt', 'theirs\n', 'Their a')
        git(self.other, 'push', '-q', 'origin', 'main')
        self.change(self.tree, 'a.txt', 'mine\n', 'My a')
        result = self.ship()
        self.assertEqual(result.returncode, 1)
        self.assertIn('conflicts', result.stderr)
        self.assertEqual(git(self.tree, 'status', '--porcelain'), '')
        self.assertNotIn('My a', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_run_names_its_log_shows_its_steps_and_ends_with_one_marker_line(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        log = self.tmp / 'ship.log'
        result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60,
                                env={**os.environ, 'SHIP_LOG': str(log)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f'ship: log: {log}', result.stdout)
        lines = log.read_text().splitlines()
        self.assertTrue(any('running the push checks' in line for line in lines))
        self.assertTrue(lines[-1].startswith('ship: DONE '), lines[-1])
        self.assertEqual(sum('ship: DONE' in line or 'ship: FAILED' in line for line in lines), 1)

    def test_a_failed_run_ends_with_a_failed_marker_that_names_the_log(self):
        self.change(self.tree, 'tools/pre-push-check.sh', '#!/bin/sh\necho "Push blocked: tests failed in desktop" >&2\nexit 2\n', 'Hook that refuses')
        log = self.tmp / 'ship.log'
        result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60,
                                env={**os.environ, 'SHIP_LOG': str(log)})
        self.assertEqual(result.returncode, 2)
        self.assertIn('Push blocked', result.stderr)
        self.assertEqual(log.read_text().splitlines()[-1], f'ship: FAILED (exit 2), log: {log}')


if __name__ == '__main__':
    unittest.main()
