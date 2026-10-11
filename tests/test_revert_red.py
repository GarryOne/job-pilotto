"""tools/revert-red.sh (11 Oct 2026): reverts a red commit of main in its own worktree and ships the revert with --fix; refuses when main is not red at that commit (or red-main.sh cannot say) unless --force; --dry-run changes nothing; sends no message."""
import os
import shutil
import subprocess

from tests.ship_fixture import ShipFixture, git, ROOT


class RevertRedTest(ShipFixture):
    def setUp(self):
        super().setUp()
        shutil.copy(ROOT / 'tools' / 'revert-red.sh', self.main / 'tools' / 'revert-red.sh')
        (self.main / 'tools' / 'pre-push-check.sh').write_text('#!/bin/sh\ncat > "$PAYLOAD_FILE"\n')   # records the push command ship.sh asks the hook about
        git(self.main, 'add', '-A'); git(self.main, 'commit', '-qm', 'Tools')
        git(self.main, 'push', '-q', 'origin', 'main')
        self.change(self.main, 'bad.txt', 'broken\n', 'Break the build')
        git(self.main, 'push', '-q', 'origin', 'main')
        self.bad = git(self.main, 'rev-parse', 'HEAD')
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'gh').write_text('#!/bin/sh\nexit 1\n')   # no answer: red-main.sh says "unknown"
        (bin_dir / 'gh').chmod(0o755)
        self.env = {**os.environ, 'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'JOB_PILOTTO_SESSION': 'test-session', 'PAYLOAD_FILE': str(self.tmp / 'payload.json')}

    def revert(self, *args):
        return subprocess.run(['bash', str(self.main / 'tools' / 'revert-red.sh'), *args], cwd=self.main, capture_output=True, text=True, timeout=120, env=self.env)

    def test_it_refuses_when_main_is_not_known_to_be_red_and_changes_nothing(self):
        result = self.revert(self.bad)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('not red as far as tools/red-main.sh can tell', result.stderr)
        self.assertEqual(git(self.origin, 'rev-parse', 'main'), self.bad)

    def test_dry_run_says_what_it_would_do_and_makes_no_worktree(self):
        result = self.revert(self.bad, '--force', '--dry-run')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f'reverting {self.bad[:7]} ("Break the build"', result.stdout)
        self.assertFalse((self.main / '.claude' / 'worktrees' / f'revert-red-{self.bad[:7]}').exists())
        self.assertEqual(git(self.origin, 'rev-parse', 'main'), self.bad)

    def test_force_reverts_the_commit_in_a_worktree_and_ships_it_with_fix(self):
        result = self.revert(self.bad, '--force')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        subjects = git(self.origin, 'log', '--format=%s', 'main').splitlines()
        self.assertEqual(subjects[0], f'Revert {self.bad[:7]}: main was red, no fix in time')
        self.assertEqual(subjects[1], 'Break the build')
        self.assertNotEqual(subprocess.run(['git', 'show', 'main:bad.txt'], cwd=self.origin, capture_output=True, text=True).returncode, 0, 'the file the red commit added is gone from main')
        body = git(self.origin, 'log', '-1', '--format=%B', 'main')
        self.assertIn('CI_RED_OK=1', (self.tmp / 'payload.json').read_text(), 'shipped as the fix: the red-main wait and block do not apply to it')
        self.assertIn('Rung: none: a revert of a red commit', body)
        self.assertIn('main was red', body)

    def test_a_commit_that_is_not_on_main_is_refused(self):
        result = self.revert('0' * 40, '--force')
        self.assertEqual(result.returncode, 2)
