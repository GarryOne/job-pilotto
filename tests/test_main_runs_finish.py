"""A workflow that runs on a push to main never cancels an older run of main (owner, 12 Oct 2026: main's commits showed red crosses, "1 cancelled and 10
successful checks", because the widget zoo cancelled its older main run when the next commit landed; GitHub draws a cancelled run as a failure).
Cancelling stays allowed on pull requests: cancel-in-progress is false, or true only for pull_request events (as recorded-pages.yml does)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PR_ONLY = re.compile(r"^\$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}$")


def runs_on_push(text):
    trigger = text.split('\njobs:')[0]
    return bool(re.search(r'^\s+push:|^on:\s*\[?[^\n]*\bpush\b', trigger, re.M))


class MainRunsFinishTest(unittest.TestCase):
    def test_no_push_workflow_cancels_an_older_main_run(self):
        offenders, seen = [], 0
        for path in sorted((ROOT / '.github' / 'workflows').glob('*.yml')):
            text = path.read_text(encoding='utf-8')
            if not runs_on_push(text): continue
            seen += 1
            for found in re.finditer(r'cancel-in-progress:\s*([^\n#]+)', text):
                value = found.group(1).strip()
                if value == 'false' or PR_ONLY.match(value): continue
                offenders.append(f'{path.name}: cancel-in-progress: {value}')
        self.assertGreater(seen, 3, 'positive control: the push workflows are read')

    def test_a_queued_main_run_is_never_replaced(self):
        # 13 Oct 2026: with cancel-in-progress off, a run of main still showed "cancelled": it was QUEUED behind the previous main run and the next merge replaced it
        # (GitHub keeps one pending run per concurrency group). On a push, every commit needs its own group. Deploys keep one group on purpose: two deploys at once
        # could finish in the wrong order and leave older code live; they run only when their files change.
        offenders = []   # a deploy is known by its group's name (site-deploy, worker-deploy, desktop-release), never a list of files
        for path in sorted((ROOT / '.github' / 'workflows').glob('*.yml')):
            text = path.read_text(encoding='utf-8')
            if not runs_on_push(text): continue
            group = re.search(r'^concurrency:\s*\n\s+group:\s*([^\n#]+)', text, re.M)
            if group and re.search(r'-(deploy|release)\s*$', group.group(1).strip()): continue
            if group and 'github.sha' not in group.group(1) and 'github.run_id' not in group.group(1): offenders.append(f'{path.name}: group {group.group(1).strip()}')
        self.assertEqual(offenders, [], "on a push, give each commit its own group: ${{ github.event_name == 'pull_request' && github.ref || github.sha }}")
        self.assertEqual(offenders, [], "a cancelled run of main shows as a red cross on main: use false, or ${{ github.event_name == 'pull_request' }}")


if __name__ == '__main__':
    unittest.main()
