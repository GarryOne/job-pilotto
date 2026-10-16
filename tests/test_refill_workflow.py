"""The CI refill (.github/workflows/replay-refill.yml; owner, 15 Oct 2026: its own workflow, its own Anthropic key). Pins: the key has NO fallback to any other key, a missing key
stops the job, a fork PR never gets it, it starts by hand or on a push to main (never from a pull request), and the spend is reported."""
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
        pick = CODE.split('\n  pick:')[1].split('\n  bundles:')[0]   # the trigger job before it checks out main's own code only
        self.assertLess(pick.index('isCrossRepository'), pick.index('actions/checkout'), 'the fork check runs before any PR code is checked out')

    def test_it_starts_by_hand_or_on_a_push_to_main_never_from_a_pull_request(self):
        on = CODE.split('\npermissions:')[0]
        self.assertIn('workflow_dispatch:', on)
        self.assertRegex(on, r"(?ms)^  push:\n    branches: \[main\]\n    paths: \['desktop/e2e/ladder-baseline.json'", 'a push to main, only when the ladder baseline or a file that builds an ask changed (owner, 15 Oct 2026; the list is guarded by refill.test.mjs)')
        self.assertNotRegex(on, r'(?m)^  (schedule|pull_request|pull_request_target):', 'no PR-started workflow may reach an AI key (pool-ci-triggers.test.mjs)')
        self.assertNotIn('github.event.pull_request', CODE)

    def test_a_push_runs_only_when_a_prompt_fingerprint_changed_and_waits_its_turn(self):
        trigger = CODE.split('\n  pick:')[0]
        self.assertIn('refill-trigger.mjs', trigger)
        self.assertIn('github.event.before', trigger)
        self.assertIn('pool-ci-wait.mjs', trigger)
        self.assertIn('POOL_WAIT_WORKFLOWS: replay-refill.yml', trigger, 'refill runs take turns: two never publish the same rows')
        self.assertRegex(CODE, r"(?m)^  pick:\n    needs: \[trigger, bundles\]\n    if: needs.trigger.outputs.run == '1'")
        self.assertRegex(CODE, r"(?m)^  bundles:\n(?:    #.*\n)*    needs: trigger\n    if: needs.trigger.outputs.run == '1'", 'the one download of the release comes first, only when the run is wanted')

    def test_main_mode_refills_every_recorded_row_through_the_guard_in_groups_of_three(self):
        self.assertIn('refill-pick.mjs --main', CODE)
        self.assertIn("MAX_ASKS: ${{ inputs.max_asks || '200' }}", CODE)
        publish = CODE.split('\n  publish:')[1].split('\n  finish:')[0]
        self.assertRegex(publish, r'max-parallel: [1-4]\b')
        self.assertIn('fromJSON(needs.pick.outputs.groups)', publish)
        self.assertIn('refill-group.mjs', publish)
        self.assertIn('NET_RECORDS_BUNDLE_SUFFIX: -g${{ matrix.group }}', publish, 'two groups in the same second never write the same asset')
        self.assertIn('--against', publish)
        self.assertIn("needs.pick.result == 'success'", publish, 'a skipped pick (no prompt change) publishes nothing')

    def test_the_spend_is_reported_once_and_a_failed_or_capped_run_on_main_tells_the_owner(self):
        finish = CODE.split('\n  finish:')[1].split('\n  notify:')[0]
        self.assertIn('ai-cost-report.mjs', finish)
        self.assertIn('site-replays-pr.yml', finish)
        self.assertIn("inputs.pr != ''", finish, 'the PR gate is re-run only for a PR run')
        notify = CODE.split('\n  notify:')[1]
        self.assertIn("inputs.pr == ''", notify)
        self.assertIn('ci-alert.mjs failure', notify)
        self.assertIn('CI_ALERTS_TELEGRAM_BOT_TOKEN', notify)
        self.assertRegex(notify, r"needs: \[trigger, pick, bundles, refill, publish, finish\]")

    def test_the_key_is_given_to_one_step_only(self):
        self.assertEqual(len(re.findall(r'secrets\.REPLAY_REFILL_ANTHROPIC_KEY', CODE)), 2, 'the presence check and the fill step, nothing else')

    def test_the_cost_is_capped_estimated_and_reported(self):
        for word in ('refill-pick.mjs', '--max-asks', 'ai-cost-report.mjs', 'replay-refill', 'estimate'):
            self.assertIn(word, TEXT)

    def test_it_never_posts_a_replay_accept_and_lists_no_pull_request_paths(self):
        self.assertNotIn('Replay-accept:', CODE)
        self.assertEqual(len(re.findall(r'(?m)^    paths:', CODE)), 1, 'the one paths filter is the push to main on the ask-building files, never a pull request')

    def test_a_replay_check_waits_for_a_refill_in_progress(self):
        replays = (ROOT / '.github' / 'workflows' / 'site-replays.yml').read_text()
        wait = replays.split('\n  refill-wait:')[1].split('\n  bundles:')[0]
        self.assertIn('POOL_WAIT_WORKFLOWS: replay-refill.yml', wait)
        self.assertIn('pool-ci-wait.mjs', wait)
        self.assertIn('continue-on-error: true', wait, 'after the cap it replays anyway: the upload is labelled stale, never no replay at all')
        self.assertRegex(replays, r"(?m)^  bundles:\n(?:    .*\n)*?    needs: \[check, refill-wait\]", 'the release is read only after the wait')


    def test_the_publish_starts_the_site_replay_with_the_runs_own_token(self):
        top = CODE.split('\njobs:')[0]
        self.assertRegex(top, r'(?m)^  actions: write', 'the run token may dispatch a workflow')
        publish = CODE.split('\n  publish:')[1].split('\n  finish:')[0]
        self.assertRegex(publish, r'DISPATCH_TOKEN: \$\{\{ github\.token \}\}', 'records-publish dispatches with it, not the PAT that writes the private records repo')
        self.assertRegex(publish, r'GH_TOKEN: \$\{\{ secrets\.NET_RECORDS_WRITE_TOKEN \}\}')


if __name__ == '__main__':
    unittest.main()
