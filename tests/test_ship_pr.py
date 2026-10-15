"""tools/ship.sh landing through a pull request (12 Oct 2026): push the branch, open a PR, turn on auto-merge, wait until it is merged; a failed required check says which and leaves the PR open.
Run on a throwaway origin with a fake `gh` (tests/fake_gh.py) that merges the branch into origin's main when auto-merge is on. Fixture: ship_fixture.py."""
import json
import os
import shutil
import stat
import subprocess
import sys
import unittest
from pathlib import Path

from tests.ship_fixture import ROOT, ShipFixture, git


class ShipPrTest(ShipFixture):
    def setUp(self):
        super().setUp()
        self.state = self.tmp / 'gh-state.json'
        self.bin = self.tmp / 'bin'
        self.bin.mkdir()
        shim = self.bin / 'gh'
        shim.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{ROOT / "tests" / "fake_gh.py"}" "$@"\n')
        shim.chmod(shim.stat().st_mode | stat.S_IEXEC)

    def pr_ship(self, state=None, *flags, timeout=90, **extra):
        self.state.write_text(json.dumps({'origin': str(self.origin), **(state or {})}))
        env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_STATE': str(self.state), 'SHIP_MODE': 'pr', 'SHIP_REVIEW': '0', 'SHIP_PR_POLL': '0', 'SHIP_RED_POLL': '0', 'JOB_PILOTTO_SESSION': '', 'JP_SESSION': '', 'JP_SESSIONS_DIR': str(self.tmp / 'no-sessions'), **extra}   # SHIP_REVIEW=0 by default: the auto-merge path
        return subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh'), *flags], cwd=self.tree, capture_output=True, text=True, timeout=timeout, env=env)

    def calls(self):
        return json.loads(self.state.read_text()).get('calls', [])

    def test_pushes_the_branch_opens_a_pr_turns_on_auto_merge_and_waits_for_the_merge(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('ship: DONE ', result.stdout)
        self.assertIn('My change', git(self.origin, 'log', '--format=%s', 'main'))
        self.assertIn('--head topic', ' '.join(self.calls()), 'the PR is from the pushed branch, not main directly')
        calls = ' | '.join(self.calls())
        self.assertIn('pr create', calls)
        self.assertIn('--title My change', calls)
        self.assertIn('Generated with [Claude Code]', calls, 'the PR body carries the attribution line')
        self.assertIn('<details>', calls, 'the commit message is folded (tools/pr-body.sh)')
        self.assertIn('pr merge', calls)
        self.assertIn('--auto --rebase', calls)
        self.assertTrue((self.main / 'mine.txt').exists(), 'the main checkout is brought up to date after the merge')

    def test_the_pr_title_names_the_session_that_opened_it(self):
        # Owner, 15 Oct 2026: "add in the PR title the name of the session that opened that PR".
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship(JOB_PILOTTO_SESSION='job-pilotto-9f')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('--title [9f] My change', ' | '.join(self.calls()))
        self.assertIn('My change', git(self.origin, 'log', '--format=%s', 'main'), 'the commit subject itself stays as written')
        self.assertNotIn('[9f]', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_pr_landing_of_slow_gate_files_takes_no_landing_queue(self):
        # Owner, 12 Oct 2026: "Everybody can open PR at any time". The PR's required checks guard main, so a local queue only made PRs wait for each other.
        (self.tree / 'desktop' / 'lib').mkdir(parents=True)
        self.change(self.tree, 'desktop/lib/x.js', '1\n', 'Touch a slow-gate path')
        result = self.pr_ship()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('queueing for the landing lock', result.stdout + result.stderr)

    def test_a_second_landing_after_the_branch_was_deleted_on_merge_goes_through(self):
        self.change(self.tree, 'one.txt', '1\n', 'First change')
        self.assertEqual(self.pr_ship().returncode, 0)
        self.assertNotIn('topic', git(self.origin, 'branch', '--list'), 'merged: the branch is deleted on origin')
        self.change(self.tree, 'two.txt', '2\n', 'Second change')
        result = self.pr_ship()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Second change', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_failed_required_check_says_which_and_leaves_the_pr_open(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'python', 'link': 'https://example.test/run/1'}})
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('ship: FAILED', result.stdout + result.stderr)
        self.assertIn('python', result.stdout + result.stderr)
        self.assertIn('https://example.test/run/1', result.stdout + result.stderr)
        self.assertNotIn('My change', git(self.origin, 'log', '--format=%s', 'main'))
        self.assertNotIn('pr close', ' '.join(self.calls()), 'the PR stays open for the session to fix and push again')

    def test_a_cancelled_check_is_a_superseded_run_not_a_failure(self):
        # 15 Oct 2026: every PR workflow cancels its older run on a push; ship.sh's own rebase push cancelled the run it was watching and it reported FAILED (#874)
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship({'fail_check_once': {'name': 'replay (3)', 'link': 'https://example.test/run/3/job/1', 'bucket': 'cancel'}})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('looking again', result.stdout + result.stderr)

    def test_a_check_that_stays_cancelled_is_a_failure(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'replay (3)', 'link': 'https://example.test/run/3/job/1', 'bucket': 'cancel'}})
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_a_second_run_reuses_the_open_pr_and_a_fixed_check_lands_it(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        self.assertEqual(self.pr_ship({'fail_check': {'name': 'python', 'link': 'https://example.test/run/1'}}).returncode, 1)
        data = json.loads(self.state.read_text()); data.pop('fail_check'); self.state.write_text(json.dumps(data))
        result = self.pr_ship(json.loads(self.state.read_text()))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(sum(1 for call in self.calls() if call.startswith('pr create')), 1, 'one PR per branch')
        self.assertIn('My change', git(self.origin, 'log', '--format=%s', 'main'))

    def test_a_failed_flow_check_rebases_and_pushes_again_by_itself(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        self.change(self.other, 'theirs.txt', 'x\n', 'Landed meanwhile')
        git(self.other, 'push', '-q', 'origin', 'main')
        result = self.pr_ship({'fail_check_once': {'name': 'All checks passed', 'link': 'https://example.test/run/2/job/9', 'step_red': True}})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('rebasing again', result.stdout)
        self.assertEqual(git(self.origin, 'log', '--format=%s', 'main').splitlines()[:2], ['My change', 'Landed meanwhile'])

    def test_a_failed_step_other_than_the_flow_one_stops_the_run(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'All checks passed', 'link': 'https://example.test/run/2/job/9'}})
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertNotIn('rebasing again', result.stdout)

    def test_no_gh_or_a_plain_path_origin_keeps_the_direct_push(self):
        self.change(self.tree, 'mine.txt', 'y\n', 'My change')
        result = subprocess.run(['bash', str(self.tree / 'tools' / 'ship.sh')], cwd=self.tree, capture_output=True, text=True, timeout=60)   # no SHIP_MODE: a local-path origin is no GitHub
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('pushing to main', result.stdout)
        self.assertNotIn('topic', git(self.origin, 'branch', '--list'), 'a direct landing pushes main only')

    def mode(self, allowed):
        self.state.write_text(json.dumps({'origin': str(self.origin), 'auto_merge_allowed': allowed}))
        git(self.tree, 'remote', 'set-url', 'origin', 'https://github.com/example/repo.git')
        env = {**os.environ, 'PATH': f'{self.bin}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_STATE': str(self.state)}
        run = lambda code: subprocess.run(['bash', '-c', f'source "{self.tree}/tools/ship-pr.sh"; {code}'], cwd=self.tree, capture_output=True, text=True, env=env).stdout.strip()
        return run('ship_mode'), run('ship_review && echo review || echo auto')

    def test_a_github_origin_always_lands_through_a_pr_and_the_repository_setting_says_who_merges(self):
        # Owner, 12 Oct 2026: "I'd like to review them all, by hand". main takes PRs only, so auto-merge off no longer means a push to main.
        self.assertEqual(self.mode(False), ('pr', 'review'), 'auto-merge not allowed: the owner merges by hand')
        self.assertEqual(self.mode(True), ('pr', 'auto'))

    def test_review_mode_stops_with_the_pr_open_once_its_required_checks_are_green(self):
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        result = self.pr_ship({}, SHIP_REVIEW='1')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('ship: REVIEW #1 https://example.test/pull/1', result.stdout)
        self.assertNotIn('ship: DONE', result.stdout)
        state = json.loads(self.state.read_text())
        self.assertEqual(state.get('state'), 'OPEN', 'never merged by ship: the owner merges')
        self.assertFalse(state.get('auto'), 'auto-merge never turned on')
        self.assertNotIn('My change', git(self.origin, 'log', '--format=%s', 'main'))

    def test_review_mode_still_reports_a_failed_required_check(self):
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'python', 'link': 'https://example.test/run/9'}}, SHIP_REVIEW='1')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("check 'python' failed", result.stdout + result.stderr)

    def test_draft_stays_a_draft_until_every_check_is_green(self):
        # Owner, 14 Oct 2026: a PR showed "Rebase and merge" while its checks still ran; --draft keeps it unmergeable until ship sees them all green.
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        result = self.pr_ship({}, '--draft', SHIP_REVIEW='1')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state = json.loads(self.state.read_text())
        self.assertTrue(any(call.startswith('pr create') and '--draft' in call for call in state['calls']), 'opened as a draft')
        self.assertFalse(state['draft'], 'marked ready once green')
        self.assertIn('marked ready for review', result.stdout)

    def test_draft_with_a_red_check_stays_a_draft(self):
        self.change(self.tree, 'mine.txt', 'x\n', 'My change')
        result = self.pr_ship({'fail_check': {'name': 'python', 'link': 'https://example.test/run/9'}}, '--draft', SHIP_REVIEW='1')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertTrue(json.loads(self.state.read_text())['draft'], 'a red PR is never marked ready')


if __name__ == '__main__':
    unittest.main()
