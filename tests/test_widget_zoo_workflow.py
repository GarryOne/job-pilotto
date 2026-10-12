"""The widget zoo is a required check that always reports (owner, 12 Oct 2026): its workflow has no `on: paths:` filter (a required check skipped by one never reports and the
PR waits for ever); a `changes` job diffs the PR's files with git (no third-party action) and the zoo job runs only when one of them is the zoo's, skipped (= passed) otherwise."""
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

    def test_the_zoo_job_is_gated_by_the_changes_output(self):
        self.assertRegex(self.text, r'(?m)^  changes:\n')
        zoo = self.text[self.text.index('\n  zoo:'):]
        self.assertRegex(zoo, r'needs: changes\b')
        self.assertIn("if: needs.changes.outputs.relevant == 'true'", zoo)

    def test_the_diff_is_plain_git_and_covers_the_zoo_paths(self):
        changes = self.text[self.text.index('\n  changes:'):self.text.index('\n  zoo:')]
        self.assertIn('git diff --name-only "$BASE...$HEAD"', changes)
        self.assertNotRegex(changes, r'uses: (?!actions/checkout)', 'no third-party action decides what changed')
        for path in ('extension/', 'desktop/lib/', 'desktop/e2e/widget-zoo/', 'widget-zoo', 'page-replay', 'replay-browser', r'\.github/workflows/widget-zoo\\.yml'):
            self.assertRegex(changes, re.escape(path) if '\\' not in path else path, path)
        self.assertIn('if [ "$EVENT" != "pull_request" ]; then echo "relevant=true"', changes, 'a push to main always replays')


if __name__ == '__main__':
    unittest.main()
