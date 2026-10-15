"""The CI refill (.github/workflows/replay-refill.yml; owner, 15 Oct 2026: its own workflow, its own Anthropic key). Pins: the key has NO fallback to any other key, a missing key
stops the job, a fork PR never gets it, it starts only by hand or the `refill` label (never every PR), and the spend is reported."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT = (ROOT / '.github/workflows/replay-refill.yml').read_text()
CODE = '\n'.join(line for line in TEXT.splitlines() if not line.lstrip().startswith('#'))


class TheRefillWorkflow(unittest.TestCase):
    def test_the_key_has_no_fallback_and_no_other_key_is_named(self):
        self.assertNotRegex(CODE, r'ANTHROPIC_API_KEY|E2E_ANTHROPIC_KEY|LIVE_POOL_ANTHROPIC_KEY', 'no other Anthropic key in this workflow')
        for use in re.findall(r'secrets\.REPLAY_REFILL_ANTHROPIC_KEY[^\n]*', CODE):
            self.assertNotIn('||', use, 'no fallback after the refill key')

    def test_a_missing_key_says_so_and_stops(self):
        self.assertRegex(CODE, r'-z "\$REFILL_KEY".*\n?.*exit 1', 'the pick job stops without the secret')
        self.assertIn('nothing was asked', CODE)

    def test_a_fork_pr_never_gets_the_key(self):
        self.assertIn('isCrossRepository', CODE)
        self.assertIn('github.event.pull_request.head.repo.full_name == github.repository', CODE)
        pick = CODE.split('\n  refill:')[0]
        self.assertLess(pick.index('isCrossRepository'), pick.index('actions/checkout'), 'the fork check runs before any PR code is checked out')

    def test_it_starts_by_hand_or_by_the_label_only(self):
        on = CODE.split('\npermissions:')[0]
        self.assertIn('workflow_dispatch:', on)
        self.assertRegex(on, r'(?s)pull_request:\s+types: \[labeled\]')
        self.assertIn("github.event.label.name == 'refill'", CODE)
        self.assertNotRegex(on, r'(?m)^  (push|schedule):')

    def test_the_key_is_given_to_one_step_only(self):
        self.assertEqual(len(re.findall(r'secrets\.REPLAY_REFILL_ANTHROPIC_KEY', CODE)), 2, 'the presence check and the fill step, nothing else')

    def test_the_cost_is_capped_estimated_and_reported(self):
        for word in ('refill-pick.mjs', '--max-asks', 'ai-cost-report.mjs', 'replay-refill', 'estimate'):
            self.assertIn(word, TEXT)

    def test_it_never_posts_a_replay_accept_and_lists_no_pull_request_paths(self):
        self.assertNotIn('Replay-accept:', CODE)
        self.assertNotRegex(CODE, r'(?m)^    paths:')


if __name__ == '__main__':
    unittest.main()
