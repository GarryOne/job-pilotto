"""A newer push to a pull request cancels its older runs, so the superseded jobs free their runners (owner, 15 Oct 2026: a flow PR started ~25 jobs, GitHub runs ~20 at once,
8 PRs are often open, and ship.sh re-pushes up to 5 times). Every workflow a PR starts has a concurrency group per PR with cancel-in-progress on the PR only; main's runs never cancel
(tests/test_main_runs_finish.py). By-hand and comment-driven workflows are listed with the reason."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
PR_ONLY = "${{ github.event_name == 'pull_request' }}"
NOT_CANCELLED = {   # workflow -> why a newer push must not cancel it
    'site-replays-accept.yml': 'it re-runs the failed jobs of the PR on a label or comment; cancelling it would drop the owner\'s accept',
}


def on_block(text):
    return text.split('\njobs:')[0]


def pr_workflows():
    return sorted(p for p in WORKFLOWS.glob('*.yml') if re.search(r'(?m)^  pull_request:', on_block(p.read_text(encoding='utf-8'))))


class PrRunsCancel(unittest.TestCase):
    def test_every_pr_workflow_cancels_its_superseded_run(self):
        found = pr_workflows()
        self.assertGreater(len(found), 8, 'positive control: the PR workflows are read')
        offenders = []
        for path in found:
            if path.name in NOT_CANCELLED: continue
            text = path.read_text(encoding='utf-8')
            top = re.search(r'(?ms)^concurrency:[^\n]*\n(.*?)(?=^\S)', text)
            if not top: offenders.append(f'{path.name}: no concurrency'); continue
            block = top.group(1)
            group = re.search(r'group:\s*([^\n#]+)', block)
            cancel = re.search(r'cancel-in-progress:\s*([^\n#]+)', block)
            if not group or not re.search(r'head_ref|pull_request\.number|github\.ref', group.group(1)): offenders.append(f'{path.name}: the group is not per PR')
            elif not cancel or cancel.group(1).strip() not in ('true', PR_ONLY): offenders.append(f'{path.name}: cancel-in-progress {cancel.group(1).strip() if cancel else "missing"}')
            elif cancel.group(1).strip() == 'true' and re.search(r'(?m)^  push:', on_block(text)): offenders.append(f'{path.name}: cancels on main too')
        self.assertEqual(offenders, [])

    def test_a_workflow_main_runs_keeps_one_run_per_commit(self):
        for name in ('tests-python.yml', 'tests-worker.yml', 'tests-site.yml', 'tests-desktop.yml', 'tests-desktop-windows.yml', 'page-cases.yml'):
            text = (WORKFLOWS / name).read_text(encoding='utf-8')
            self.assertIn('github.sha', re.search(r'(?ms)^concurrency:[^\n]*\n(.*?)(?=^\S)', text).group(1), name)

    def test_the_by_hand_exceptions_still_exist(self):
        for name in NOT_CANCELLED: self.assertTrue((WORKFLOWS / name).exists(), name)


if __name__ == '__main__':
    unittest.main()
