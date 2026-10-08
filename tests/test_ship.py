"""tools/ship.sh, the one-command landing of a worktree (6 Oct 2026): run on a throwaway origin with a stub push hook, so each step is checked in
seconds: rebase over a moved main, the hook's refusal, the main checkout update (and its skip on overlapping edits), and the worktree cleanup."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def git(cwd, *args, check=True):
    return subprocess.run(['git', *args], cwd=cwd, check=check, capture_output=True, text=True).stdout.strip()


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.origin, self.main, self.other = self.tmp / 'origin.git', self.tmp / 'main', self.tmp / 'other'
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(self.origin)], check=True)
        (self.main / 'tools').mkdir(parents=True)
        for name in ('ship.sh', 'worktree.sh'):
            shutil.copy(ROOT / 'tools' / name, self.main / 'tools' / name)
        self.hook = self.main / 'tools' / 'pre-push-check.sh'
        self.hook.write_text('#!/bin/sh\ncat > /dev/null\n')   # the real hook has its own tests; here it only has to be asked
        (self.main / 'a.txt').write_text('a\n')
        git(self.main, 'init', '-q', '-b', 'main')
        for key, value in (('user.email', 't@example.com'), ('user.name', 'Test')):
            git(self.main, 'config', key, value)
        git(self.main, 'add', '-A')
        git(self.main, 'commit', '-qm', 'Start')
        git(self.main, 'remote', 'add', 'origin', str(self.origin))
        git(self.main, 'push', '-q', 'origin', 'main')
        subprocess.run(['git', 'clone', '-q', str(self.origin), str(self.other)], check=True)
        for key, value in (('user.email', 't@example.com'), ('user.name', 'Test')):
            git(self.other, 'config', key, value)
        self.tree = Path(git(self.main, 'rev-parse', '--show-toplevel')) / '.claude' / 'worktrees' / 'topic'
        subprocess.run(['sh', str(self.main / 'tools' / 'worktree.sh'), 'topic'], cwd=self.main, check=True, capture_output=True)

    def change(self, where, name, text, subject):
        (where / name).write_text(text)
        git(where, 'add', name)
        git(where, 'commit', '-qm', subject)

    def ship(self, *flags):
        return subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), *flags], cwd=self.tree, capture_output=True, text=True, timeout=60)

    def test_rebases_over_a_moved_main_pushes_updates_the_checkout_and_removes_the_worktree(self):
        self.change(self.other, 'theirs.txt', 'x\n', 'Another session pushed')
        git(self.other, 'push', '-q', 'origin', 'main')
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.ship()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(git(self.origin, 'log', '--format=%s', 'main').splitlines(), ['My change', 'Another session pushed', 'Start'])
        self.assertTrue((self.main / 'mine.txt').exists() and (self.main / 'theirs.txt').exists(), 'the main checkout is up to date')
        self.assertFalse(self.tree.exists(), 'the worktree is removed')
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

    def test_background_returns_at_once_and_the_log_ends_with_done(self):
        self.change(self.tree, 'tools/pre-push-check.sh', '#!/bin/sh\ncat > /dev/null\nsleep 3\n', 'Slow hook')
        log = self.tmp / 'ship.log'
        started = time.time()
        result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), '--background'], cwd=self.tree, capture_output=True, text=True, timeout=60,
                                env={**os.environ, 'SHIP_LOG': str(log)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(time.time() - started, 2.5, 'it returned before the checks finished')
        self.assertIn(str(log), result.stdout)
        for _ in range(60):
            if log.exists() and 'ship: DONE' in log.read_text():
                break
            time.sleep(0.5)
        self.assertTrue(log.read_text().splitlines()[-1].startswith('ship: DONE '), log.read_text())
        self.assertIn('Slow hook', git(self.origin, 'log', '--format=%s', 'main'))


if __name__ == '__main__':
    unittest.main()
