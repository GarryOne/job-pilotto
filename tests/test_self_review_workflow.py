"""The weekly self-review workflow stays cheap, least-privilege and proposal-only."""
import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'weekly-self-review.yml'


class SelfReviewWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()

    def test_runs_weekly_and_on_demand(self):
        self.assertIn("- cron: '0 18 * * 0'", self.text)
        self.assertIn('workflow_dispatch:', self.text)

    def test_claude_is_capped_and_least_privilege(self):
        self.assertIn('--model claude-sonnet-5-5', self.text)
        turns = int(re.search(r'--max-turns (\d+)', self.text).group(1))
        self.assertLessEqual(turns, 25)  # keeps a run under ~$0.50
        tools = re.search(r'--allowedTools "([^"]+)"', self.text).group(1).split(',')
        self.assertEqual([t for t in tools if t.startswith('Bash(')], ['Bash(git show:*)', 'Bash(git log:*)'])

    def test_only_rule_and_skill_files_reach_the_pr(self):
        self.assertIn(r"^(CLAUDE\.md|AGENTS\.md|docs/rules/[^/]+\.md|\.claude/skills/[^/]+/SKILL\.md)$", self.text)
        self.assertIn('branch="self-review/', self.text)
        self.assertIn('DATA', self.text)
        self.assertNotIn('workflows: write', self.text)


if __name__ == '__main__':
    unittest.main()
