"""tools/pre-push-check.sh, the Claude Code hook before every git commit/push: run on a throwaway repo with a stub `gh` and a stub
tools/check.sh, so each guard is checked in seconds without GitHub or the real suites (5 Oct 2026: four sessions were blocked by a red
main that passed this hook on leftover files, and by a long subject whose amend was denied)."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / 'tools' / 'pre-push-check.sh'

# The stub suite: fails when the file a test needs is missing from the checkout it runs in, and logs where it ran.
CHECK = '''#!/usr/bin/env bash
echo "$PWD $*" >> "$CHECK_LOG"
[ -f desktop/shared/needed.js ] || { echo "not ok - needed.js missing"; exit 1; }
'''
# The stub gh: `run list --status completed` answers the last finished build, any other `run list` the newest build.
GH = '''#!/usr/bin/env bash
case "$*" in *"--status completed"*) echo "$GH_COMPLETED" ;; *"run view"*) echo "$GH_FAILED_JOBS" ;; *"run rerun"*) echo "$*" >> "$CHECK_LOG.rerun" ;; *"run list"*) echo "$GH_LATEST" ;; esac
'''


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class PrePushCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo, origin, self.bin = self.tmp / 'repo', self.tmp / 'origin.git', self.tmp / 'bin'
        for folder in ('src', 'worker', 'tools', 'desktop'):
            (self.repo / folder).mkdir(parents=True)
        self.bin.mkdir()
        (self.repo / 'src' / 'daily.py').write_text('')
        (self.repo / 'worker' / 'package.json').write_text('{}')
        (self.repo / 'desktop' / '.gitignore').write_text('shared/\n')
        shutil.copy(HOOK, self.repo / 'tools' / 'pre-push-check.sh')
        shutil.copy(ROOT / 'tools' / 'commit-subject.py', self.repo / 'tools' / 'commit-subject.py')
        (self.repo / 'tools' / 'stale-expectations.mjs').write_text('')
        for path, text in ((self.repo / 'tools' / 'check.sh', CHECK), (self.bin / 'gh', GH), (self.bin / 'actionlint', '#!/bin/sh\n')):
            path.write_text(text)
            path.chmod(0o755)
        subprocess.run(['git', 'init', '-q', '--bare', '-b', 'main', str(origin)], check=True)
        git(self.repo, 'init', '-q', '-b', 'main')
        git(self.repo, 'config', 'user.email', 't@example.com')
        git(self.repo, 'config', 'user.name', 'Test')
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', 'Start')
        git(self.repo, 'remote', 'add', 'origin', str(origin))
        git(self.repo, 'push', '-q', 'origin', 'main')
        self.log = self.tmp / 'check.log'
        self.env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'CHECK_LOG': str(self.log),
                    'GH_COMPLETED': f'success {git(self.repo, "rev-parse", "--short=7", "HEAD")} https://x/runs/1', 'GH_LATEST': '', 'GH_FAILED_JOBS': ''}

    def hook(self, command, **env):
        payload = json.dumps({'tool_input': {'command': command}, 'cwd': str(self.repo)})
        result = subprocess.run(['bash', str(self.repo / 'tools' / 'pre-push-check.sh')], input=payload, capture_output=True,
                                text=True, env={**self.env, **env}, timeout=120)
        return result.returncode, result.stderr

    def commit(self, subject, files=None):
        for name, text in (files or {'change.txt': subject}).items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        git(self.repo, 'add', '-A')
        git(self.repo, 'commit', '-qm', subject)

    def needed_committed(self):
        (self.repo / 'desktop' / '.gitignore').write_text('')
        self.commit('Add the needed file', {'desktop/shared/needed.js': 'export {};\n'})

    def test_other_commands_pass_untouched(self):
        self.assertEqual(self.hook('git status')[0], 0)
        self.assertFalse(self.log.exists())

    def test_a_long_subject_is_stopped_at_commit_time(self):
        long = 'x' * 80
        self.assertEqual(self.hook('git commit -m "Short subject"')[0], 0)
        code, err = self.hook(f'git commit -qm "{long}"')
        self.assertEqual(code, 2)
        self.assertIn('at most 72', err)
        self.assertEqual(self.hook(f'COMMIT_LONG_OK=1 git commit -m "{long}"')[0], 0)

    def test_a_pushed_long_subject_names_the_way_out_without_an_amend(self):
        self.needed_committed()
        self.commit('y' * 80)
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 2)
        self.assertIn('COMMIT_LONG_OK=1 git push', err)

    def test_suites_run_on_a_clean_checkout_so_leftovers_cannot_hide_a_break(self):
        # The fa1f838 case: the file the tests need is git-ignored and only left in this folder by an earlier run.
        (self.repo / 'desktop' / 'shared').mkdir()
        (self.repo / 'desktop' / 'shared' / 'needed.js').write_text('export {};\n')
        self.commit('Use the needed file')
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 2)
        self.assertIn('clean checkout', err)
        self.assertNotIn(str(self.repo), self.log.read_text())

    def test_each_area_runs_alone_and_no_worktree_is_left(self):
        self.needed_committed()
        self.assertEqual(self.hook('PUSH_FULL=1 git push origin HEAD:main'), (0, ''))
        runs = self.log.read_text().splitlines()
        self.assertEqual([line.split(' --area ')[1].split()[0] for line in runs], ['python', 'worker', 'site', 'desktop'])
        self.assertEqual(len({line.split()[0] for line in runs}), 4, 'a fresh checkout per area')
        self.assertEqual(len(git(self.repo, 'worktree', 'list').splitlines()), 1)

    def areas_run(self, command='git push origin HEAD:main'):
        self.log.unlink(missing_ok=True)
        code, err = self.hook(command)
        runs = self.log.read_text().splitlines() if self.log.exists() else []
        return code, [line.split(' --area ')[1].split()[0] for line in runs], err

    def test_only_the_areas_a_push_touches_run(self):
        self.needed_committed()
        self.assertEqual(self.areas_run()[:2], (0, ['desktop']))
        self.commit('Worker only', {'worker/a.js': 'x'})
        self.assertEqual(self.areas_run()[:2], (0, ['worker', 'desktop']))   # origin/main..HEAD still holds the desktop commit
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Engine change', {'src/ai/x.py': 'x'})
        self.assertEqual(self.areas_run()[:2], (0, ['python', 'desktop']), 'the engine also runs its desktop callers')
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Site only', {'site/p.html': 'x'})
        self.assertEqual(self.areas_run()[:2], (0, ['site']))
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Unknown top-level file', {'Makefile': 'x'})
        self.assertEqual(self.areas_run()[:2], (0, ['python', 'worker', 'site', 'desktop']), 'an unknown path runs everything')

    def test_docs_alone_run_no_suite_and_full_forces_all(self):
        self.needed_committed()
        git(self.repo, 'push', '-q', 'origin', 'HEAD:main')
        self.commit('Docs', {'README.md': 'x', 'docs/a.md': 'y'})
        self.assertEqual(self.areas_run()[:2], (0, []))
        self.assertEqual(self.areas_run('PUSH_FULL=1 git push origin HEAD:main')[:2], (0, ['python', 'worker', 'site', 'desktop']))

    def test_a_red_main_with_no_failed_job_is_rerun_not_blocking(self):
        self.needed_committed()
        bad = git(self.repo, 'rev-parse', '--short=7', 'HEAD')
        code, err = self.hook('git push origin HEAD:main', GH_COMPLETED=f'cancelled {bad} https://x/runs/42', GH_FAILED_JOBS='0')
        self.assertEqual(code, 0, err)
        self.assertIn('re-running it', err)
        self.assertIn('run rerun 42 --failed', Path(f'{self.log}.rerun').read_text())
        # One job that really failed still blocks.
        code, _ = self.hook('git push origin HEAD:main', GH_COMPLETED=f'failure {bad} https://x/runs/42', GH_FAILED_JOBS='1')
        self.assertEqual(code, 2)

    def test_a_red_main_blocks_with_the_way_to_unblock_it(self):
        self.needed_committed()
        bad = git(self.repo, 'rev-parse', '--short=7', 'HEAD')
        code, err = self.hook('git push origin HEAD:main', GH_COMPLETED=f'failure {bad} https://x/runs/42')
        self.assertEqual(code, 2)
        self.assertIn(f'git revert --no-edit {bad}', err)
        self.assertIn('gh run view --log-failed 42', err)
        self.assertEqual(self.hook('CI_RED_OK=1 git push origin HEAD:main', GH_COMPLETED=f'failure {bad} https://x/runs/42')[0], 0)

    def test_a_fix_in_flight_on_top_of_red_lets_a_push_that_contains_it_through(self):
        self.commit('Break it')
        bad = git(self.repo, 'rev-parse', '--short=7', 'HEAD')
        self.needed_committed()
        fix = git(self.repo, 'rev-parse', 'HEAD')
        red = {'GH_COMPLETED': f'failure {bad} https://x/runs/42', 'GH_LATEST': fix}
        code, err = self.hook('git push origin HEAD:main', **red)
        self.assertEqual(code, 0, err)
        self.assertIn('is building', err)
        # A build of a commit this push does not contain proves nothing about it.
        code, _ = self.hook('git push origin HEAD:main', **{**red, 'GH_LATEST': 'f' * 40})
        self.assertEqual(code, 2)


if __name__ == '__main__':
    unittest.main()
