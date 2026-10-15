"""The refill workflow's tree (tools/refill-merge-main.sh): a PR branch older than the workflow still runs, because main's files are merged into the PR's head on the runner
(cc, 15 Oct 2026: #824 predated #835 and had no refill-pick.mjs). A PR that conflicts with main stops with the reason."""
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools/refill-merge-main.sh'
WORKFLOW = (ROOT / '.github/workflows/replay-refill.yml').read_text()
ENV = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null'}


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, env=ENV, check=True, capture_output=True, text=True).stdout


def repo(tmp):
    """-> (work clone on an OLD PR branch, origin) where main has since gained a refill tool and changed shared.txt."""
    origin = Path(tmp) / 'origin.git'
    work = Path(tmp) / 'work'
    git(tmp, 'init', '-q', '--bare', '-b', 'main', str(origin))
    git(tmp, 'clone', '-q', str(origin), str(work))
    (work / 'shared.txt').write_text('one\n')
    git(work, 'add', '-A'); git(work, 'commit', '-qm', 'base'); git(work, 'push', '-q', 'origin', 'HEAD:main')
    git(work, 'checkout', '-q', '-b', 'old-pr')
    (work / 'pr-change.txt').write_text('the PR\n')
    git(work, 'add', '-A'); git(work, 'commit', '-qm', 'pr')
    git(work, 'checkout', '-q', 'main')
    (work / 'refill-pick.mjs').write_text('// a tool main gained after the PR branched\n')
    git(work, 'add', '-A'); git(work, 'commit', '-qm', 'main moves on'); git(work, 'push', '-q', 'origin', 'main')
    git(work, 'checkout', '-q', 'old-pr')
    return work, origin


def run(work):
    return subprocess.run(['bash', str(SCRIPT), '824'], cwd=work, env=ENV, capture_output=True, text=True)


class TheRefillTree(unittest.TestCase):
    def test_a_pr_branch_older_than_the_workflow_gets_main_s_tools_and_keeps_its_own_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            work, _ = repo(tmp)
            self.assertFalse((work / 'refill-pick.mjs').exists(), 'positive control: the old branch lacks the tool')
            done = run(work)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertTrue((work / 'refill-pick.mjs').exists(), 'main\'s tool is there now')
            self.assertTrue((work / 'pr-change.txt').exists(), 'the PR\'s own change is kept')
            self.assertRegex(done.stdout, r'refill: PR 824 head [0-9a-f]+ \+ main [0-9a-f]+')

    def test_a_pr_that_conflicts_with_main_stops_with_the_reason_and_leaves_the_tree_clean(self):
        with tempfile.TemporaryDirectory() as tmp:
            work, _ = repo(tmp)
            (work / 'shared.txt').write_text('PR version\n')
            git(work, 'add', '-A'); git(work, 'commit', '-qm', 'pr edits shared')
            other = Path(tmp) / 'other'
            git(tmp, 'clone', '-q', str(Path(tmp) / 'origin.git'), str(other))
            (other / 'shared.txt').write_text('main version\n')
            git(other, 'add', '-A'); git(other, 'commit', '-qm', 'main edits shared'); git(other, 'push', '-q', 'origin', 'main')
            done = run(work)
            self.assertEqual(done.returncode, 1)
            self.assertIn('does not merge with main: rebase it onto main first (nothing was asked)', done.stderr)
            self.assertEqual(git(work, 'status', '--porcelain').strip(), '', 'the merge was aborted')

    def test_the_workflow_runs_the_pr_s_build_with_main_s_tools(self):
        code = '\n'.join(line for line in WORKFLOW.splitlines() if not line.lstrip().startswith('#'))
        self.assertNotIn('/merge', code, 'the merge ref is as old as the PR\'s last update: never the source of the tools')
        self.assertNotRegex(code, r'ref: refs/pull', 'every checkout is the workflow\'s own ref (main): the PR comes in by the merge step')
        pick, rest = code.split('\n  refill:', 1)
        self.assertNotIn('refill-merge-main', pick, 'the pick job runs main\'s tools on data only: it never checks out the PR\'s code')
        self.assertEqual(rest.count('cp tools/refill-merge-main.sh "$RUNNER_TEMP/refill-merge-main.sh"'), 2, 'the script is copied out of main\'s tree before the PR\'s tree replaces it')
        self.assertEqual(rest.count('git fetch --quiet origin "refs/pull/$PR/head"'), 2)
        self.assertEqual(rest.count('bash "$RUNNER_TEMP/refill-merge-main.sh" "$PR"'), 2, 'main is merged into the PR\'s head in the refill and the publish jobs')
        self.assertEqual(rest.count('fetch-depth: 0'), 2)
        self.assertIn('"refs/pull/$PR/head"', pick, 'the pick reads the PR\'s pins file as data')


if __name__ == '__main__':
    unittest.main()
