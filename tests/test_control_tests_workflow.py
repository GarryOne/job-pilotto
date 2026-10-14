"""The widget zoo runs on a pull request only when GitHub's `paths:` says it changed what the zoo loads (owner, 14 Oct 2026: "drop your shared pick logic, rely fully
on gh workflow paths"); it is not a required check (a skipped workflow never reports); main runs it on every push."""
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'control-tests.yml'


class WidgetZooWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()

    def test_a_pull_request_runs_it_only_for_its_paths_and_main_always(self):
        on = self.text[self.text.index('\non:'):self.text.index('\nconcurrency:')]
        pr = on[on.index('  pull_request:'):on.index('\n  push:')]
        for path in ('extension/**', 'desktop/e2e/widget-zoo/**', 'desktop/e2e/widget-zoo.mjs'):
            self.assertIn(f"- '{path}'", pr)
        self.assertNotRegex(on[on.index('\n  push:'):], r'(?m)^\s+paths', 'main runs it on every push')

    def test_no_shared_pick(self):
        self.assertNotIn('ci-needed', self.text)
        self.assertNotRegex(self.text, r'git diff --name-only', 'no second list of the zoo\'s paths')


if __name__ == '__main__':
    unittest.main()
