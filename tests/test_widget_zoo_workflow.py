"""The widget zoo is a required check that always reports (owner, 12 Oct 2026): its workflow has no `on: paths:` filter (a required check skipped by one never reports and the
PR waits for ever); its first step asks tools/ci-needed.sh whether the PR changes anything the zoo loads, and its later steps are skipped (the job passes) otherwise."""
import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'widget-zoo.yml'


class WidgetZooWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()

    def test_the_triggers_have_no_paths_filter(self):
        on = self.text[self.text.index('\non:'):self.text.index('\nconcurrency:')]
        self.assertNotRegex(on, r'(?m)^\s+paths(-ignore)?:', 'a paths filter skips the workflow, and a required check that never reports blocks the PR')
        self.assertIn('pull_request:', on)

    def test_the_zoo_job_asks_the_pick_before_it_installs(self):
        # Was a `changes` job grepping the PR's files against a path list (12 Oct 2026); now the one pick every required job asks (tools/ci-needed.sh zoo,
        # tools/affected-jobs.py, what tools/replay-files.mjs says the zoo loads). tests/test_affected_jobs.py checks the step's place and the gated steps.
        zoo = self.text[self.text.index('\n  zoo:'):]
        self.assertIn('bash tools/ci-needed.sh zoo', zoo)
        self.assertNotIn('needs: changes', zoo)
        self.assertNotRegex(self.text, r'git diff --name-only', 'no second list of the zoo\'s paths')

if __name__ == '__main__':
    unittest.main()
