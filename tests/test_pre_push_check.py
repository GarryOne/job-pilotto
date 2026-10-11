"""tools/pre-push-check.sh, the Claude Code hook before every git commit/push (1 of 3: commit subjects, red main, the clean checkouts, the gates beside the suites). Fixture: pre_push_fixture.py."""
import unittest
import shutil
import time
from pathlib import Path

from tests.pre_push_fixture import *   # noqa: F401,F403 (the fixture: setUp, hook, commit, ...)
from tests.pre_push_fixture import PrePushFixture


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class PrePushCheckTest(PrePushFixture):
    def test_other_commands_pass_untouched(self):
        self.assertEqual(self.hook('git status')[0], 0)
        self.assertFalse(self.log.exists())

    def test_a_long_subject_is_stopped_at_commit_time(self):
        long = 'x' * 80
        self.assertEqual(self.hook('git commit -m "Short subject"')[0], 0)
        code, err = self.hook(f'git commit -qm "{long}"')
        self.assertEqual(code, 2)
        self.assertIn('at most 72', err)
        self.assertEqual(self.hook(f'COMMIT_LONG_OK=1 git commit -m "{long}"')[0], 0)

    def test_a_pushed_long_subject_names_the_way_out_without_an_amend(self):
        self.needed_committed()
        self.commit('y' * 80)
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 2)
        self.assertIn('COMMIT_LONG_OK=1 git push', err)

    def test_suites_run_on_a_clean_checkout_so_leftovers_cannot_hide_a_break(self):
        # The fa1f838 case: the file the tests need is git-ignored and only left in this folder by an earlier run.
        (self.repo / 'desktop' / 'shared').mkdir()
        (self.repo / 'desktop' / 'shared' / 'needed.js').write_text('export {};\n')
        self.commit('Use the needed file')
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 2)
        self.assertIn('clean checkout', err)
        self.assertNotIn(str(self.repo), self.log.read_text())

    def test_each_area_runs_alone_and_no_worktree_is_left(self):
        self.needed_committed()
        self.assertEqual(self.hook('PUSH_FULL=1 git push origin HEAD:main'), (0, ''))
        runs = self.log.read_text().splitlines()
        self.assertEqual(sorted(line.split(' --area ')[1].split()[0] for line in runs), ['desktop', 'python', 'site', 'worker'])   # areas run side by side: no order
        self.assertEqual(len({line.split()[0] for line in runs}), 4, 'a fresh checkout per area')
        self.assertEqual(len(git(self.repo, 'worktree', 'list').splitlines()), 1)

    def test_no_checkout_is_removed_while_another_area_runs(self):
        # git's worktree add and remove race on .git/worktrees (9 Oct 2026: "failed to read .git/worktrees/worker/commondir", and a red
        # main from "tests failed in site" with no reason): the checkouts are made before the suites start and removed after all end.
        # The desktop stub waits for the other three to finish, then looks whether their checkouts are still there.
        (self.repo / 'tools' / 'check.sh').write_text(CHECK + textwrap.dedent('''\
            if [ "$2" = desktop ]; then
              for _ in $(seq 400); do [ "$(wc -l < "$CHECK_LOG.done" 2>/dev/null || echo 0)" -ge 3 ] && break; sleep 0.05; done
              while read -r tree; do [ -d "$tree" ] && echo kept || echo gone; done < "$CHECK_LOG.done" > "$CHECK_LOG.seen"
            else echo "$PWD" >> "$CHECK_LOG.done"; fi
            '''))
        self.needed_committed()
        self.assertEqual(self.hook('PUSH_FULL=1 git push origin HEAD:main'), (0, ''))
        self.assertEqual(Path(f'{self.log}.seen').read_text().split(), ['kept'] * 3)
        self.assertEqual(len(git(self.repo, 'worktree', 'list').splitlines()), 1, 'every checkout removed at the end')

    def test_a_red_main_with_no_failed_job_is_rerun_not_blocking(self):
        self.needed_committed()
        bad = git(self.repo, 'rev-parse', '--short=7', 'HEAD')
        code, err = self.hook('git push origin HEAD:main', GH_COMPLETED=f'cancelled {bad} https://x/runs/42', GH_FAILED_JOBS='0')
        self.assertEqual(code, 0, err)
        self.assertIn('re-running it', err)
        self.assertIn('run rerun 42 --failed', Path(f'{self.log}.rerun').read_text())
        # One job that really failed still blocks.
        code, _ = self.hook('git push origin HEAD:main', GH_COMPLETED=f'failure {bad} https://x/runs/42', GH_FAILED_JOBS='1')
        self.assertEqual(code, 2)

    def test_a_red_main_blocks_with_the_way_to_unblock_it(self):
        self.needed_committed()
        bad = git(self.repo, 'rev-parse', '--short=7', 'HEAD')
        code, err = self.hook('git push origin HEAD:main', GH_COMPLETED=f'failure {bad} https://x/runs/42')
        self.assertEqual(code, 2)
        self.assertIn(f'git revert --no-edit {bad}', err)
        self.assertIn('gh run view --log-failed 42', err)
        self.assertEqual(self.hook('CI_RED_OK=1 git push origin HEAD:main', GH_COMPLETED=f'failure {bad} https://x/runs/42')[0], 0)

    def test_a_fix_in_flight_on_top_of_red_lets_a_push_that_contains_it_through(self):
        self.commit('Break it')
        bad = git(self.repo, 'rev-parse', '--short=7', 'HEAD')
        self.needed_committed()
        fix = git(self.repo, 'rev-parse', 'HEAD')
        red = {'GH_COMPLETED': f'failure {bad} https://x/runs/42', 'GH_LATEST': fix}
        code, err = self.hook('git push origin HEAD:main', **red)
        self.assertEqual(code, 0, err)
        self.assertIn('is building', err)
        # A build of a commit this push does not contain proves nothing about it.
        code, _ = self.hook('git push origin HEAD:main', **{**red, 'GH_LATEST': 'f' * 40})
        self.assertEqual(code, 2)

    @unittest.skipUnless(shutil.which('node'), 'needs node')
    def test_the_journey_gate_runs_beside_the_suites_and_a_failing_gate_blocks_with_its_output(self):
        # owner, 11 Oct 2026: lock wait + journey gate + slowest suite, one after another; the gate now starts with the suites
        self.gate_stubs(seconds=1)
        code, err = self.hook('git push origin HEAD:main')
        order = Path(str(self.log) + '.order').read_text().split()
        self.assertEqual(code, 0, err)
        self.assertLess(order.index('suite-start'), order.index('gate-end'), 'the suite starts before the gate has finished')
        self.assertLess(order.index('gate-start'), order.index('suite-end'))
        self.assertIn('journey gate: stub says yes', err, err)
        self.gate_stubs(journey_exit=1)
        code, err = self.hook('git push origin HEAD:main')
        self.assertEqual(code, 2)
        self.assertIn('Push blocked: the journey gate failed', err)
        self.assertIn('journey gate: stub says no', err)

    @unittest.skipUnless(shutil.which('node'), 'needs node')
    def test_jp_gate_serial_runs_the_gate_first_and_says_so(self):
        self.gate_stubs(seconds=1)
        code, err = self.hook('git push origin HEAD:main', JP_GATE_SERIAL='1')
        order = Path(str(self.log) + '.order').read_text().split()
        self.assertEqual(code, 0, err)
        self.assertLess(order.index('gate-end'), order.index('suite-start'), 'serial: the gate is done before the suite starts')
        self.assertIn('JP_GATE_SERIAL=1', err)


if __name__ == '__main__':
    unittest.main()
