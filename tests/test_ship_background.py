"""tools/ship.sh --background, 2 of 2: it returns at once, the log ends with a marker, a kill of the caller or of the run, and the extension version taken at ship time after the rebase. Fixture: ship_fixture.py."""
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
