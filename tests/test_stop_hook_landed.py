"""The Stop hook (tools/stop-test-check.sh) never reports failures of a worktree tools/ship.sh removed while its tests ran (10 Oct 2026: 40 false errors)."""
import unittest
from pathlib import Path


class StopHookLandedWorktreeTest(unittest.TestCase):
    def test_a_removed_worktree_has_its_results_dropped_after_the_wait(self):
        text = (Path(__file__).resolve().parents[1] / 'tools' / 'stop-test-check.sh').read_text()
        wait = text.index('wait "${pids[@]}"')
        guard = text.index('[ ! -e "$repo/.git" ]')
        report = text.index('failed=""')
        self.assertLess(wait, guard, 'checked after the suites ran')
        self.assertLess(guard, report, 'before any failure is collected')


if __name__ == '__main__':
    unittest.main()
