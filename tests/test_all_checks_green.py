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
    def run_with(self, polls):
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
            env = {**os.environ, 'PATH': f'{tmp}{os.pathsep}{os.environ["PATH"]}', 'FAKE': str(tmp), 'APPEAR_S': '0', 'POLL_S': '0', 'WAIT_MIN': '1'}
            done = subprocess.run(['bash', str(SCRIPT), 'o/r', 'abcdef1234', '99'], env=env, capture_output=True, text=True, timeout=60)
            return done.returncode, done.stdout

    def test_waits_for_running_workflows_then_passes_when_all_green(self):
        code, out = self.run_with(['in_progress\t-\tCI · Tests · python\ncompleted\tsuccess\tCI · Harness tests\n',
                                   'completed\tsuccess\tCI · Tests · python\ncompleted\tsuccess\tCI · Harness tests\n'])
        self.assertEqual(code, 0, out)
        self.assertIn('2 workflow(s)', out)

    def test_a_red_cancelled_or_skipped_run(self):
        for conclusion, code_wanted in (('failure', 1), ('cancelled', 1), ('skipped', 0)):
            code, out = self.run_with([f'completed\tsuccess\tCI · Tests · python\ncompleted\t{conclusion}\tCI · Site replays · PR (12 of 16 pinned rows)\n'])
            self.assertEqual(code, code_wanted, (conclusion, out))
            if code_wanted:
                self.assertIn(f'CI · Site replays · PR (12 of 16 pinned rows) ({conclusion})', out)

    def test_no_other_workflow_passes(self):
        code, out = self.run_with([''])
        self.assertEqual(code, 0, out)

    def test_the_job_starts_on_every_pr_skips_its_own_run_and_is_required(self):
        gate = (ROOT / '.github/workflows/pr-gate.yml').read_text()
        self.assertNotRegex(gate.split('\njobs:')[0], r'(?m)^\s+paths(-ignore)?:')
        self.assertIn('bash tools/all-checks-green.sh "$GITHUB_REPOSITORY" "$HEAD_SHA" "$GITHUB_RUN_ID"', gate)
        self.assertIn('select(.event == \\"pull_request\\" and (.databaseId | tostring) != \\"$own\\")', SCRIPT.read_text())
        self.assertIn("all\\ checks\\ green", (ROOT / 'tools/pr-settings.sh').read_text())


if __name__ == '__main__':
    unittest.main()
