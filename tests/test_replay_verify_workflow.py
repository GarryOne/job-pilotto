"""Confirmed offline (.github/workflows/replay-verify.yml; owner, 14 Oct 2026): never on a PR and never a required check, starts after the nightly offline replay on main or by hand,
stops when nothing it replays changed, sends only fixed-word verdicts with the narrow publish key (main only), never calls a model, and keeps each commit's own run."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github' / 'workflows' / 'replay-verify.yml').read_text()
TRIGGER = re.search(r'(?m)^on:\n((?:  .*\n|\n)+?)(?=^\S)', WORKFLOW).group(1)


class ReplayVerifyWorkflow(unittest.TestCase):
    def test_never_on_a_pr_after_the_nightly_replay_or_by_hand(self):
        self.assertNotIn('pull_request', TRIGGER)
        self.assertIn('workflow_run:', TRIGGER)
        self.assertIn("'CI · Replay vs live (offline)'", TRIGGER)
        self.assertIn('workflow_dispatch:', TRIGGER)
        self.assertIn("branches: [main]", TRIGGER)
        required = (ROOT / 'tools/pr-settings.sh').read_text()
        self.assertNotIn('Confirmed offline', required)

    def test_the_trigger_names_a_workflow_that_exists(self):
        self.assertIn('name: CI · Replay vs live (offline)', (ROOT / '.github/workflows/replay-offline.yml').read_text())

    def test_it_stops_when_nothing_it_replays_changed(self):
        self.assertIn('Anything changed since the last green run?', WORKFLOW)
        self.assertIn("':!desktop/e2e/test'", WORKFLOW)

    def test_only_main_sends_with_the_narrow_key_and_no_model_is_asked(self):
        send = re.search(r'- name: Send the verdicts[^\n]*\n\s+if: ([^\n]+)', WORKFLOW)
        self.assertEqual(send.group(1).strip(), "github.ref == 'refs/heads/main'")
        self.assertIn('REPLAYS_PUBLISH_KEY: ${{ secrets.REPLAYS_PUBLISH_KEY }}', WORKFLOW)
        self.assertNotIn('ANTHROPIC', WORKFLOW)
        self.assertNotIn('OPENAI', WORKFLOW)

    def test_each_commit_keeps_its_own_run_and_the_matrix_is_capped(self):
        self.assertRegex(WORKFLOW, r'group: replay-verify-\$\{\{ github\.sha \}\}')
        self.assertIn('cancel-in-progress: false', WORKFLOW)
        self.assertIn('max-parallel: 5', WORKFLOW)


if __name__ == '__main__':
    unittest.main()
