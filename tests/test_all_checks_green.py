"""tools/all-checks-green.sh, the one required check that collects every other PR check (owner, 14 Oct 2026: a PR was mergeable while its replay gate and suites
still ran): with a fake gh that plays the workflow runs of a commit, it waits for every run, passes only when each ended green, and ignores its own run."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools/all-checks-green.sh'


class AllChecksGreen(unittest.TestCase):
    def run_with(self, polls, **extra):
        """polls: what each `gh run list` call prints (TAB-separated status, conclusion, workflow), the last repeats."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            for i, body in enumerate(polls):
                (tmp / f'poll{i}').write_text(body)
            (tmp / 'gh').write_text('#!/usr/bin/env bash\n'
                                    'n=$(cat "$FAKE/count" 2>/dev/null || echo 0); echo $((n + 1)) > "$FAKE/count"\n'
                                    f'last={len(polls) - 1}; [ "$n" -gt "$last" ] && n=$last\n'
                                    'cat "$FAKE/poll$n"\n')
            (tmp / 'gh').chmod(0o755)
            env = {**os.environ, 'PATH': f'{tmp}{os.pathsep}{os.environ["PATH"]}', 'FAKE': str(tmp), 'APPEAR_S': '0', 'POLL_S': '0', 'WAIT_MIN': '1', **extra}
            done = subprocess.run(['bash', str(SCRIPT), 'o/r', 'abcdef1234', '99'], env=env, capture_output=True, text=True, timeout=60)
            return done.returncode, done.stdout

    def test_waits_for_running_workflows_then_passes_when_all_green(self):
        code, out = self.run_with(['in_progress\t-\tCI · Tests · python\ncompleted\tsuccess\tCI · Harness tests\n',
                                   'completed\tsuccess\tCI · Tests · python\ncompleted\tsuccess\tCI · Harness tests\n'])
        self.assertEqual(code, 0, out)
        self.assertIn('2 workflow(s)', out)

    def test_the_settle_time_counts_from_the_commits_first_run_not_from_the_gates_start(self):
        # Owner, 17 Oct 2026: every gate slept a fixed 90 s even when all checks had ended long before.
        import time
        started = time.time()
        old = 'completed\tsuccess\tCI · Tests · python\t2026-10-17T10:00:00Z\nown\t-\tCI · Pull request\t2026-10-17T10:00:05Z\n'
        code, out = self.run_with([old], APPEAR_S='60')
        self.assertEqual(code, 0, out)
        self.assertLess(time.time() - started, 20, 'a commit pushed long ago is judged at once')
        now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        fresh = f'completed\tsuccess\tCI · Tests · python\t{now}\nown\t-\tCI · Pull request\t{now}\n'
        started = time.time()
        code, out = self.run_with([fresh], APPEAR_S='3', POLL_S='1')
        self.assertEqual(code, 0, out)
        self.assertGreaterEqual(time.time() - started, 2, 'a fresh push still waits for late workflows to appear')

    def test_a_red_cancelled_or_skipped_run(self):
        for conclusion, code_wanted in (('failure', 1), ('cancelled', 1), ('skipped', 0)):
            code, out = self.run_with([f'completed\tsuccess\tCI · Tests · python\ncompleted\t{conclusion}\tCI · Page cases\n'])
            self.assertEqual(code, code_wanted, (conclusion, out))
            if code_wanted:
                self.assertIn(f'CI · Page cases ({conclusion})', out)

    def test_a_cancelled_run_is_superseded_by_a_newer_success_of_the_same_workflow(self):
        desc = 'CI · PR description laid out'
        code, out = self.run_with([f'completed\tcancelled\t{desc}\t2026-10-16T18:00:00Z\ncompleted\tsuccess\t{desc}\t2026-10-16T18:05:00Z\ncompleted\tsuccess\tCI · Tests · python\t2026-10-16T18:01:00Z\n'])
        self.assertEqual(code, 0, out)

    def test_a_cancelled_run_alone_an_older_success_or_a_failure_stays_red(self):
        desc = 'CI · PR description laid out'
        cases = {
            'cancelled alone': f'completed\tcancelled\t{desc}\t2026-10-16T18:00:00Z\n',
            'the success is OLDER': f'completed\tsuccess\t{desc}\t2026-10-16T18:00:00Z\ncompleted\tcancelled\t{desc}\t2026-10-16T18:05:00Z\n',
            'a success of ANOTHER workflow': f'completed\tcancelled\t{desc}\t2026-10-16T18:00:00Z\ncompleted\tsuccess\tCI · Tests · python\t2026-10-16T18:05:00Z\n',
            'a failure with a newer success of another workflow': f'completed\tfailure\t{desc}\t2026-10-16T18:00:00Z\ncompleted\tsuccess\tCI · Tests · python\t2026-10-16T18:05:00Z\n',
            'a failure with a newer success of the same workflow': f'completed\tfailure\t{desc}\t2026-10-16T18:00:00Z\ncompleted\tsuccess\t{desc}\t2026-10-16T18:05:00Z\n',
            'a cancelled run with a newer SKIPPED run': f'completed\tcancelled\t{desc}\t2026-10-16T18:00:00Z\ncompleted\tskipped\t{desc}\t2026-10-16T18:05:00Z\n',
            'no time on the runs': f'completed\tcancelled\t{desc}\ncompleted\tsuccess\t{desc}\n',
        }
        for name, body in cases.items():
            code, out = self.run_with([body])
            self.assertEqual(code, 1, (name, out))

    def test_an_older_run_of_the_gates_own_workflow_cancelled_by_this_run_is_ignored(self):
        gate = 'CI · Pull request'
        code, out = self.run_with([f'completed\tcancelled\t{gate}\t2026-10-17T10:00:00Z\nown\t-\t{gate}\t2026-10-17T10:05:00Z\ncompleted\tsuccess\tCI · Tests · python\t2026-10-17T10:01:00Z\n'])
        self.assertEqual(code, 0, out)
        self.assertIn('2 workflow(s)', out, 'this run itself is not counted')

    def test_another_running_copy_of_the_gate_is_not_waited_for(self):
        # 17 Oct 2026: the code run and the description-edit run of the gate ran on one commit; each waited for the other until 60 min, both red.
        gate = 'CI · Pull request'
        code, out = self.run_with([f'in_progress\t-\t{gate}\t2026-10-17T14:45:00Z\nown\t-\t{gate}\t2026-10-17T14:45:01Z\ncompleted\tsuccess\tCI · Tests · python\t2026-10-17T14:45:02Z\n'])
        self.assertEqual(code, 0, out)
        # Another workflow still running is still waited for, and its red still counts.
        code, out = self.run_with([f'in_progress\t-\t{gate}\t2026-10-17T14:45:00Z\nown\t-\t{gate}\t2026-10-17T14:45:01Z\nin_progress\t-\tCI · Tests · python\t2026-10-17T14:45:02Z\n',
                                   f'in_progress\t-\t{gate}\t2026-10-17T14:45:00Z\nown\t-\t{gate}\t2026-10-17T14:45:01Z\ncompleted\tfailure\tCI · Tests · python\t2026-10-17T14:45:02Z\n'])
        self.assertEqual(code, 1, out)
        self.assertIn('CI · Tests · python (failure)', out)
        self.assertNotIn(gate, out.split('not green', 1)[-1], 'the other gate copy is not listed as red')

    def test_a_newer_cancelled_copy_of_the_gate_is_ignored(self):
        # #1199, 17 Oct 2026: a 2nd gate run on the same commit was cancelled AFTER this one started; it was read as not green.
        gate = 'CI · Pull request'
        for conclusion in ('cancelled', 'failure'):   # two copies once failed EACH OTHER, so re-runs never cleared it
            code, out = self.run_with([f'completed\t{conclusion}\t{gate}\t2026-10-17T10:05:00Z\nown\t-\t{gate}\t2026-10-17T10:00:00Z\ncompleted\tsuccess\tCI · Tests · python\t2026-10-17T10:01:00Z\n'])
            self.assertEqual(code, 0, (conclusion, out))
        code, out = self.run_with([f'completed\tfailure\t{gate}\t2026-10-17T10:05:00Z\nown\t-\t{gate}\t2026-10-17T10:00:00Z\ncompleted\tfailure\tCI · Tests · python\t2026-10-17T10:01:00Z\n'])
        self.assertEqual(code, 1, 'another workflow red still turns it red')

    def test_a_cancelled_run_stays_red_when_this_run_is_older_or_of_another_workflow(self):
        gate, other = 'CI · Pull request', 'CI · Harness tests'
        cases = {
            'this run is another workflow': f'completed\tcancelled\t{other}\t2026-10-17T10:00:00Z\nown\t-\t{gate}\t2026-10-17T10:05:00Z\n',
            'no own row': f'completed\tcancelled\t{gate}\t2026-10-17T10:00:00Z\n',
        }
        for name, body in cases.items():
            code, out = self.run_with([body])
            self.assertEqual(code, 1, (name, out))

    def test_the_query_asks_for_the_creation_time(self):
        self.assertIn('event,createdAt', SCRIPT.read_text())

    def test_no_other_workflow_passes(self):
        code, out = self.run_with([''])
        self.assertEqual(code, 0, out)

    def test_the_job_starts_on_every_pr_skips_its_own_run_and_is_required(self):
        gate = (ROOT / '.github/workflows/pr-gate.yml').read_text()
        self.assertNotRegex(gate.split('\njobs:')[0], r'(?m)^\s+paths(-ignore)?:')
        self.assertIn('bash tools/all-checks-green.sh "$GITHUB_REPOSITORY" "$HEAD_SHA" "$GITHUB_RUN_ID"', gate)
        self.assertIn('(.databaseId | tostring) == \\"$own\\" then \\"own\\"', SCRIPT.read_text())
        self.assertIn("All\\ checks\\ passed", (ROOT / 'tools/pr-settings.sh').read_text())


if __name__ == '__main__':
    unittest.main()
