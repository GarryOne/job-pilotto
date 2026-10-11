"""tools/ship.sh, the one-command landing of a worktree (6 Oct 2026): run on a throwaway origin with a stub push hook, so each step is checked in
seconds: rebase over a moved main, the hook's refusal, the main checkout update (and its skip on overlapping edits), and the worktree cleanup."""
import os
import re
import signal
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


    def start_background(self, hook_seconds):
        """A background run whose push checks take hook_seconds; returns (log, run pid) as the caller sees them."""
        self.change(self.tree, 'tools/pre-push-check.sh', f'#!/bin/sh\ncat > /dev/null\nsleep {hook_seconds}\n', 'Slow hook')
        log = self.tmp / 'ship-bg.log'
        out = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), '--background'], cwd=self.tree, capture_output=True, text=True, timeout=60,
                             env={**os.environ, 'SHIP_LOG': str(log)}).stdout
        pid = int(re.search(r'\(pid (\d+)\)', out).group(1))
        for _ in range(40):                                   # until the checks are running
            if log.exists() and 'running the push checks' in log.read_text():
                break
            time.sleep(0.25)
        return log, pid

    def wait_for_marker(self, log):
        for _ in range(60):
            if re.search(r'^ship: (DONE|FAILED)', log.read_text(), re.M):
                break
            time.sleep(0.5)
        return log.read_text()

    def test_a_background_run_killed_during_the_checks_ends_failed_and_pushes_nothing(self):
        # 10 Oct 2026: a killed run logged "ship: DONE nothing to push" with its commit unpushed.
        log, pid = self.start_background(30)
        os.kill(pid, signal.SIGTERM)
        text = self.wait_for_marker(log)
        self.assertIn('ship: stopped by signal TERM', text)
        self.assertTrue(text.splitlines()[-1].startswith('ship: FAILED (exit 143)'), text)
        self.assertNotIn('ship: DONE', text)
        self.assertNotIn('Slow hook', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_background_run_survives_a_kill_of_its_callers_process_group(self):
        # The run has its own session: the caller's group kill (a tool call ending) must not reach it.
        self.change(self.tree, 'tools/pre-push-check.sh', '#!/bin/sh\ncat > /dev/null\nsleep 4\n', 'Slow hook')
        log = self.tmp / 'ship-group.log'
        caller = subprocess.Popen(['bash', '-c', f'SHIP_LOG={log} bash {self.tree}/tools/ship.sh --background >/dev/null; sleep 60'], cwd=self.tree, start_new_session=True)
        for _ in range(40):
            if log.exists() and 'running the push checks' in log.read_text():
                break
            time.sleep(0.25)
        os.killpg(caller.pid, signal.SIGTERM)
        caller.wait(timeout=10)
        text = self.wait_for_marker(log)
        self.assertTrue(text.splitlines()[-1].startswith('ship: DONE '), text)
        self.assertIn('Slow hook', git(self.origin, 'log', '--format=%s', 'main'))

    def test_the_extension_version_is_taken_at_ship_time_after_the_rebase(self):
        # Two sessions took the same version (0.9.182 and 0.9.185 twice, 11 Oct 2026): the branch's own bump is replaced by the next free one, and
        # the rebase over a main that moved the version is no conflict.
        if not shutil.which('node'):
            self.skipTest('needs node')
        for name in ('extension-version-bump.mjs', 'merge-extension-version.mjs', 'landing-lock.sh'):
            shutil.copy(ROOT / 'tools' / name, self.main / 'tools' / name)
        (self.main / 'desktop' / 'scripts').mkdir(parents=True)
        shutil.copy(ROOT / 'desktop' / 'scripts' / 'extension-fingerprint.mjs', self.main / 'desktop' / 'scripts' / 'extension-fingerprint.mjs')
        (self.main / 'desktop' / 'package.json').write_text('{"type": "module"}\n')
        (self.main / 'extension').mkdir()
        (self.main / 'extension' / 'manifest.json').write_text('{\n  "manifest_version": 3,\n  "version": "0.0.1",\n  "name": "x"\n}\n')
        (self.main / 'extension' / 'a.js').write_text('one\n')
        (self.main / '.gitattributes').write_text('extension/manifest.json merge=ext-manifest\nextension/fingerprint.json merge=ext-fingerprint\n')
        node = lambda cwd: subprocess.run(['node', 'desktop/scripts/extension-fingerprint.mjs', '--write'], cwd=cwd, check=True, capture_output=True)
        node(self.main)
        git(self.main, 'add', '-A')
        git(self.main, 'commit', '-qm', 'Extension 0.0.1')
        git(self.main, 'push', '-q', 'origin', 'main')
        git(self.other, 'pull', '-q', 'origin', 'main')
        subprocess.run(['sh', str(self.main / 'tools' / 'worktree.sh'), 'ext'], cwd=self.main, check=True, capture_output=True)
        tree = self.main / '.claude' / 'worktrees' / 'ext'
        (tree / 'extension' / 'b.js').write_text('mine\n')
        (tree / 'extension' / 'manifest.json').write_text((tree / 'extension' / 'manifest.json').read_text().replace('0.0.1', '0.0.2'))
        node(tree)
        git(tree, 'add', '-A')
        git(tree, 'commit', '-qm', 'Mine, bumped to 0.0.2 by hand')
        (self.other / 'extension' / 'a.js').write_text('theirs\n')
        (self.other / 'extension' / 'manifest.json').write_text((self.other / 'extension' / 'manifest.json').read_text().replace('0.0.1', '0.0.2'))
        node(self.other)
        git(self.other, 'add', '-A')
        git(self.other, 'commit', '-qm', 'Theirs, 0.0.2')
        git(self.other, 'push', '-q', 'origin', 'main')
        result = subprocess.run(['bash', str(tree / 'tools' / 'ship.sh')], cwd=tree, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        landed = subprocess.run(['git', 'show', 'main:extension/manifest.json'], cwd=self.origin, capture_output=True, text=True).stdout
        self.assertIn('"version": "0.0.3"', landed)
        fingerprint = subprocess.run(['git', 'show', 'main:extension/fingerprint.json'], cwd=self.origin, capture_output=True, text=True).stdout
        self.assertIn('"version": "0.0.3"', fingerprint)
        self.assertIn('extension version taken', result.stdout + result.stderr)
        git(self.main, 'pull', '-q', '--ff-only', 'origin', 'main')
        check = subprocess.run(['node', 'desktop/scripts/extension-fingerprint.mjs'], cwd=self.main, capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, 'the fingerprint matches the landed extension')


if __name__ == '__main__':
    unittest.main()
