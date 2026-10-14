"""The nightly beta's replay gate (tools/nightly-replay-gate.sh; owner, 14 Oct 2026): a green replay run on the commit passes, a red one fails, and a commit with
no run yet (a merge after the 02:30 run) starts one and waits for it instead of building without it. A fake gh plays GitHub."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATE = ROOT / 'tools' / 'nightly-replay-gate.sh'
FAKE = '''#!/usr/bin/env bash
state="$FAKE_DIR/state"
if [ "$1 $2" = "workflow run" ]; then echo dispatched >> "$FAKE_DIR/calls"; echo "1 completed ${AFTER_DISPATCH}" > "$state"; exit 0; fi
if [ "$1 $2" = "run list" ]; then
  case "$*" in *"--workflow ${ONLY_WORKFLOW:-}"*|*) ;; esac
  [ -n "${ONLY_WORKFLOW:-}" ] && case "$*" in *"--workflow $ONLY_WORKFLOW "*) ;; *) exit 0;; esac
  cat "$state" 2>/dev/null; exit 0; fi
exit 1
'''


class NightlyReplayGate(unittest.TestCase):
    def run_gate(self, state, after_dispatch='success'):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'gh').write_text(FAKE)
            os.chmod(Path(tmp) / 'gh', 0o755)
            if state: (Path(tmp) / 'state').write_text(state + '\n')
            env = {**os.environ, 'PATH': f"{tmp}{os.pathsep}{os.environ['PATH']}", 'FAKE_DIR': tmp, 'AFTER_DISPATCH': after_dispatch,
                   'GITHUB_REPOSITORY': 'o/r', 'GITHUB_SHA': 'abcdef1234', 'GH_TOKEN': 'x', 'REPLAY_GATE_WAIT_MIN': '1'}
            out = subprocess.run(['bash', str(GATE)], capture_output=True, text=True, env=env, timeout=60).stdout.strip().splitlines()[-1]
            calls = (Path(tmp) / 'calls').read_text() if (Path(tmp) / 'calls').exists() else ''
            return out, calls

    def test_a_green_run_passes_and_a_red_one_fails(self):
        self.assertEqual(self.run_gate('7 completed success'), ('pass', ''))
        out, _ = self.run_gate('7 completed failure')
        self.assertTrue(out.startswith('fail: the replay on abcdef1 is failure'), out)

    def test_a_run_under_the_old_file_name_counts_until_28_oct_2026(self):
        os.environ['ONLY_WORKFLOW'] = 'replay-offline.yml'
        try: self.assertEqual(self.run_gate('7 completed success'), ('pass', ''))
        finally: del os.environ['ONLY_WORKFLOW']

    def test_no_run_yet_starts_one_and_waits_for_its_verdict(self):
        self.assertEqual(self.run_gate('', 'success'), ('pass', 'dispatched\n'))
        out, calls = self.run_gate('', 'failure')
        self.assertEqual(calls, 'dispatched\n')
        self.assertTrue(out.startswith('fail:'), out)


if __name__ == '__main__':
    unittest.main()
