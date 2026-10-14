"""tools/replay-gate-status.sh, the required stand-in for the PR replay gate (owner, 14 Oct 2026: a PR was mergeable while "replay gate" still ran): with a fake gh
that plays the replay gate's run states, it passes when no run appears, waits for a started run, and fails on anything but a green end."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools/replay-gate-status.sh'


class ReplayGateStatus(unittest.TestCase):
    def run_with(self, states):
        """states: the lines the fake `gh run list` prints, one per call (the last repeats); '' = no run yet."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / 'states').write_text('\n'.join(states) + '\n')
            (tmp / 'gh').write_text('#!/usr/bin/env bash\n'
                                    'n=$(cat "$FAKE/count" 2>/dev/null || echo 0); echo $((n + 1)) > "$FAKE/count"\n'
                                    'total=$(wc -l < "$FAKE/states"); i=$((n + 1)); [ "$i" -gt "$total" ] && i=$total\n'
                                    'sed -n "${i}p" "$FAKE/states"\n')
            (tmp / 'gh').chmod(0o755)
            env = {**os.environ, 'PATH': f'{tmp}{os.pathsep}{os.environ["PATH"]}', 'FAKE': str(tmp), 'APPEAR_S': '1', 'POLL_S': '0', 'WAIT_MIN': '1'}
            done = subprocess.run(['bash', str(SCRIPT), 'o/r', 'abcdef1234'], env=env, capture_output=True, text=True, timeout=60)
            return done.returncode, done.stdout

    def test_no_replay_gate_run_passes(self):
        code, out = self.run_with([''])
        self.assertEqual(code, 0, out)
        self.assertIn('changes no apply-flow code', out)

    def test_a_started_run_is_waited_for_and_green_passes(self):
        code, out = self.run_with(['', '7 in_progress - https://x/7', '7 in_progress - https://x/7', '7 completed success https://x/7'])
        self.assertEqual(code, 0, out)
        self.assertIn('green: https://x/7', out)

    def test_a_red_or_cancelled_run_fails(self):
        for end in ('failure', 'cancelled'):
            code, out = self.run_with([f'7 completed {end} https://x/7'])
            self.assertEqual(code, 1, (end, out))
            self.assertIn(f"ended '{end}'", out)

    def test_the_job_starts_on_every_pr_and_is_required(self):
        gate = (ROOT / '.github/workflows/pr-gate.yml').read_text()
        self.assertNotRegex(gate.split('\njobs:')[0], r'(?m)^\s+paths(-ignore)?:')
        self.assertIn('bash tools/replay-gate-status.sh', gate)
        self.assertIn("replay\\ gate\\ status", (ROOT / 'tools/pr-settings.sh').read_text())


if __name__ == '__main__':
    unittest.main()
