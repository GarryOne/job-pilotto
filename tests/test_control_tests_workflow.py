"""The widget zoo runs on a pull request only when GitHub's `paths:` says it changed what the zoo loads (owner, 14 Oct 2026: "drop your shared pick logic, rely fully
on gh workflow paths"); it is not a required check (a skipped workflow never reports); main runs it on every push."""
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'control-tests.yml'


class WidgetZooWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()

    def test_a_pull_request_runs_it_only_for_its_paths_and_main_always(self):
        # Since #883 (15 Oct 2026) main runs the zoo as a step of build.yml's one Linux job, not as its own push run.
        on = self.text[self.text.index('\non:'):self.text.index('\nconcurrency:')]
        for path in ('extension/**', 'desktop/e2e/widget-zoo/**', 'desktop/e2e/widget-zoo.mjs'):
            self.assertIn(f"- '{path}'", on)
        self.assertNotIn('\n  push:', on, 'main runs it inside CI · Tests, not as a push run of its own')
        self.assertIn('widget-zoo.mjs', (ROOT / '.github' / 'workflows' / 'build.yml').read_text(), 'main runs the zoo on every push, in build.yml')

    def test_no_shared_pick(self):
        self.assertNotIn('ci-needed', self.text)
        self.assertNotRegex(self.text, r'git diff --name-only', 'no second list of the zoo\'s paths')


if __name__ == '__main__':
    unittest.main()
