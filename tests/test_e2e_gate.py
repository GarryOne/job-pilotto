"""The end-to-end gate in tools/release-stable.sh, as a pure decision: may this build be promoted, judging by the e2e runs GitHub lists?

A human promotion needs a green, fresh run of THIS build's commit; the daily canary auto-promote, which cannot start a run, may accept the latest run on main.
A cancelled or skipped run says nothing about the product, so it never counts as red (2 Oct 2026: cancelling a superseded run would have blocked a release).
"""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import e2e_gate

NOW = datetime(2026, 10, 2, 20, 0, tzinfo=timezone.utc)
SHA = 'abc1234def5678'


def run(conclusion, sha=SHA, age_hours=1):
    return {'conclusion': conclusion, 'headSha': sha, 'createdAt': (NOW - timedelta(hours=age_hours)).strftime('%Y-%m-%dT%H:%M:%SZ')}


class VerdictTests(unittest.TestCase):
    def test_a_green_fresh_run_of_the_commit_passes(self):
        self.assertEqual(e2e_gate.verdict([run('success')], SHA, 'commit', NOW), 'green')

    def test_the_newest_run_of_the_commit_decides(self):
        self.assertEqual(e2e_gate.verdict([run('success'), run('failure', age_hours=5)], SHA, 'commit', NOW), 'green')
        self.assertEqual(e2e_gate.verdict([run('failure'), run('success', age_hours=5)], SHA, 'commit', NOW), f'red {SHA[:7]}')

    def test_a_run_of_another_commit_proves_nothing_in_commit_mode(self):
        self.assertEqual(e2e_gate.verdict([run('success', sha='fff0000aaaa')], SHA, 'commit', NOW), 'none')

    def test_in_latest_mode_the_newest_run_on_main_stands_in(self):
        self.assertEqual(e2e_gate.verdict([run('success', sha='fff0000aaaa')], SHA, 'latest', NOW), 'green')
        self.assertEqual(e2e_gate.verdict([run('failure', sha='fff0000aaaa')], SHA, 'latest', NOW), 'red fff0000')

    def test_an_old_green_run_is_stale(self):
        self.assertEqual(e2e_gate.verdict([run('success', age_hours=49)], SHA, 'commit', NOW), 'stale')
        self.assertEqual(e2e_gate.verdict([run('success', age_hours=47)], SHA, 'commit', NOW), 'green')

    def test_cancelled_and_skipped_runs_are_not_a_verdict(self):
        self.assertEqual(e2e_gate.verdict([run('cancelled'), run('skipped'), run('success', age_hours=3)], SHA, 'commit', NOW), 'green')
        self.assertEqual(e2e_gate.verdict([run('cancelled')], SHA, 'commit', NOW), 'none')

    def test_no_runs_is_none(self):
        self.assertEqual(e2e_gate.verdict([], SHA, 'commit', NOW), 'none')
        self.assertEqual(e2e_gate.verdict([], SHA, 'latest', NOW), 'none')



class CiVerdictTests(unittest.TestCase):
    """The other half of the nightly gate: build.yml (the unit suites, the app's packaging checks) must be green on the build's commit too."""

    def test_green_only_when_every_run_of_the_commit_succeeded(self):
        self.assertEqual(e2e_gate.ci_verdict([{'conclusion': 'success'}, {'conclusion': 'success'}]), 'green')
        self.assertEqual(e2e_gate.ci_verdict([{'conclusion': 'success'}, {'conclusion': 'failure'}]), 'red')
        self.assertEqual(e2e_gate.ci_verdict([{'conclusion': 'cancelled'}]), 'red')

    def test_no_run_is_not_green(self):
        self.assertEqual(e2e_gate.ci_verdict([]), 'none')


if __name__ == '__main__':
    unittest.main()


class BetaApprovalTests(unittest.TestCase):
    """A beta that both platforms approved is the proof for the same build (owner, 12 Oct 2026: promote the beta-approved artifact, no fresh run)."""
    SHA = '7e07642a1b2c3d4e5f60718293a4b5c6d7e8f901'
    MAC = 'Beta-approved: unit suites and every end-to-end suite passed on commit 7e07642 (2026-10-12)'
    WIN = 'Beta-approved (Windows): unit suites and every Windows end-to-end suite passed on commit 7e07642 (2026-10-12)'

    def test_both_platforms_approving_this_commit_is_green(self):
        self.assertEqual(e2e_gate.beta_verdict(f'notes\n{self.MAC}\n{self.WIN}\n', self.SHA), 'green')

    def test_one_platform_alone_is_not_enough(self):
        self.assertEqual(e2e_gate.beta_verdict(self.MAC, self.SHA), 'none')
        self.assertEqual(e2e_gate.beta_verdict(self.WIN, self.SHA), 'none')

    def test_an_approval_of_another_commit_proves_nothing(self):
        other = self.MAC.replace('7e07642', '1111111') + '\n' + self.WIN
        self.assertEqual(e2e_gate.beta_verdict(other, self.SHA), 'none')

    def test_a_line_that_only_mentions_the_words_is_not_an_approval(self):
        self.assertEqual(e2e_gate.beta_verdict(f'Not yet: Beta-approved: soon (commit 7e07642)\n{self.WIN}', self.SHA), 'none')

    def test_no_notes_is_none(self):
        self.assertEqual(e2e_gate.beta_verdict('', self.SHA), 'none')
