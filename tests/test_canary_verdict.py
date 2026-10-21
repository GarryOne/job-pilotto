"""The stable canary blames the stable build only when a suite on it failed; a plan (harness) failure is reported as the harness (#740)."""
import re
import unittest
from pathlib import Path

from tools.canary_verdict import verdict

WORKFLOW = (Path(__file__).resolve().parent.parent / '.github/workflows/stable-canary.yml').read_text()


def job(name, conclusion):
    return {'name': name, 'conclusion': conclusion}


class CanaryVerdict(unittest.TestCase):
    def test_plan_only_failure_is_the_harness(self):
        self.assertEqual(verdict([job('plan', 'failure'), job('apply', 'skipped')]), 'harness')

    def test_suite_failure_is_stable(self):
        self.assertEqual(verdict([job('plan', 'success'), job('apply', 'failure')]), 'stable')
        self.assertEqual(verdict([job('plan', 'failure'), job('apply', 'failure')]), 'stable')

    def test_all_green(self):
        self.assertEqual(verdict([job('plan', 'success'), job('apply', 'success')]), 'green')

    def test_workflow_files_stable_issue_only_for_stable(self):
        issue = re.search(r'if \[ "\$RESULT" = red \]; then(.*?)\n          fi\n', WORKFLOW, re.S).group(1)
        self.assertIn('fails the end-to-end journey', issue)
        self.assertNotIn('harness', issue)
        self.assertIn('RESULT" = harness', WORKFLOW)


if __name__ == '__main__':
    unittest.main()
