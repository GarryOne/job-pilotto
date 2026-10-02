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


if __name__ == '__main__':
    unittest.main()
