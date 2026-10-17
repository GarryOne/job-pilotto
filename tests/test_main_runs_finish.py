"""On main the NEWEST commit's run decides (owner, 15 Oct 2026: "cancel main's push runs for every commit but the newest; we want to optimize the 20 runners at most": 27 page-case
runs of merged commits queued behind each other). Before that (12-13 Oct 2026) the rule was the opposite: every commit kept its own run, because a cancelled run drew a red cross.
A workflow that runs on a push to main shares ONE group on main and cancels its older run; a by-hand run is its own group and never cancelled. Exceptions are named with a reason:
a deploy (a started deploy finishes, a waiting older one is replaced: the newest carries everything). Since 15 Oct 2026 main starts two jobs per push (build.yml: one Linux job, one Windows job).
Readers of a commit's verdict (tools/red-main.sh, tools/release-checks.sh, tools/canary_promote.py) treat a cancelled run as 'superseded': tests/test_red_main.py, tests/test_e2e_gate.py."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCEPTIONS = {
    'site.yml': 'a deploy: one group, a started deploy finishes and a waiting older one is replaced by the newest',
    'site-next.yml': 'a deploy: one group, a started deploy finishes and a waiting older one is replaced by the newest',
    'worker.yml': 'a deploy: one group, a started deploy finishes and a waiting older one is replaced by the newest',
    'release-ready-runner.yml': 'a deploy: one group, a started deploy finishes and a waiting older one is replaced by the newest',
}


def runs_on_push(text):
    trigger = text.split('\njobs:')[0]
    return bool(re.search(r'^  push:|^on:[ \t]*\[?[^\n#]*\bpush\b', trigger, re.M))


def concurrency(text):
    block = re.search(r'(?ms)^concurrency:[^\n]*\n(.*?)(?=^\S)', text)
    if not block: return None, None
    group = re.search(r'group:\s*([^\n#]+)', block.group(1))
    cancel = re.search(r'cancel-in-progress:\s*([^\n#]+)', block.group(1))
    return group and group.group(1).strip(), cancel and cancel.group(1).strip()


class NewestMainRunWins(unittest.TestCase):
    def push_workflows(self):
        found = {p.name: p.read_text(encoding='utf-8') for p in sorted((ROOT / '.github' / 'workflows').glob('*.yml'))}
        return {name: text for name, text in found.items() if runs_on_push(text)}

    def test_a_push_to_main_cancels_the_older_commits_run(self):
        pushed = self.push_workflows()
        self.assertGreaterEqual(len(pushed), 4, 'positive control: the push workflows are read (CI · Tests and the three deploys)')
        offenders = []
        for name, text in pushed.items():
            if name in EXCEPTIONS: continue
            group, cancel = concurrency(text)
            if 'ci-tests-main' in (group or ''):
                if cancel != 'false': offenders.append(f'{name}: CI · Tests must let a started run finish, cancel-in-progress {cancel}')
                continue
            if not group or "github.event_name == 'push' && 'main'" not in group and 'ci-tests-main' not in group: offenders.append(f'{name}: no shared group on main ({group})')
            elif cancel not in ('true', "${{ github.event_name != 'workflow_dispatch' }}"): offenders.append(f'{name}: cancel-in-progress {cancel}')
        self.assertEqual(offenders, [], 'a push workflow: group <name>-main on a push and cancel-in-progress: true (a by-hand run is its own group, not cancelled); CI · Tests (ci-tests-main) is the exception: false, so a started run finishes')

    def test_a_by_hand_run_is_never_cancelled_by_a_push(self):
        for name, text in self.push_workflows().items():
            if name in EXCEPTIONS or 'workflow_dispatch' not in text.split('\njobs:')[0]: continue
            group, cancel = concurrency(text)
            self.assertIn('github.run_id', group, f'{name}: a by-hand run needs its own group')

    def test_the_exceptions_are_real_and_still_do_not_cancel(self):
        for name in EXCEPTIONS:
            text = (ROOT / '.github' / 'workflows' / name).read_text(encoding='utf-8')
            self.assertIn(name, self.push_workflows())
            self.assertEqual(concurrency(text)[1], 'false', name)

    def test_scheduled_and_workflow_run_workflows_are_not_cancelled_by_a_push(self):
        # their group never holds a push: they are not in the push list, and a cancel on them could only come from their own next run
        for path in (ROOT / '.github' / 'workflows').glob('*.yml'):
            text = path.read_text(encoding='utf-8')
            if runs_on_push(text) or not re.search(r'(?m)^  (schedule|workflow_run):', text.split('\njobs:')[0]): continue
            self.assertNotIn("'push'", concurrency(text)[0] or '', path.name)


if __name__ == '__main__':
    unittest.main()
