"""An intended replay drop accepted on the PR itself (owner, 14 Oct 2026; .github/workflows/site-replays-accept.yml): a label or a trusted `Replay-accept:` comment re-runs ONLY the failed
verdict of the PR's replay gate and then "all checks green" (the required aggregate must read the re-judged result), with main's copy of the workflow, never the PR's code."""
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACCEPT = (ROOT / '.github/workflows/site-replays-accept.yml').read_text()
GATE = (ROOT / '.github/workflows/site-replays-pr.yml').read_text()
SCRIPT = re.search(r'run: \|\n((?:          .*\n|\n)+)', ACCEPT).group(1)
SCRIPT = '\n'.join(line[10:] for line in SCRIPT.split('\n'))


class AcceptWorkflow(unittest.TestCase):
    def test_main_copy_no_checkout_least_permissions(self):
        on = ACCEPT.split('\njobs:')[0]
        self.assertIn('pull_request_target:', on)
        self.assertIn('issue_comment:', on)
        self.assertNotIn('actions/checkout', ACCEPT, "never the PR's code")
        self.assertRegex(ACCEPT, r'(?m)^permissions:\n  actions: write\n  pull-requests: read\n')
        self.assertIn('author_association', ACCEPT)
        self.assertNotRegex(on, r'(?m)^\s+paths:', 'a comment has no paths')

    def test_the_gate_reads_the_prs_accepts_live_and_judges_with_them(self):
        self.assertIn('node replay-accepts.mjs - "$RUNNER_TEMP/accepts.json" --pr "$PR"', GATE)
        self.assertIn('--accepts "$RUNNER_TEMP/accepts.json"', GATE)
        self.assertIn('pull-requests: read', GATE)
        self.assertIn('pattern: replay-pr-${{ github.run_id }}-*', GATE, 'a re-run of the same run reads the same replays')

    def run_with(self, runs):
        """runs: {workflow file: 'id status conclusion'} as `gh run list` prints them; -> the gh calls made."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / 'gh').write_text('#!/usr/bin/env bash\necho "$*" >> "$FAKE/calls"\n'
                                    'case "$*" in\n'
                                    '  "pr view"*) echo abc1234567;;\n'
                                    '  *"--workflow site-replays-pr.yml"*) cat "$FAKE/replay";;\n'
                                    '  *"--workflow pr-gate.yml"*) cat "$FAKE/gate";;\n'
                                    'esac\n')
            (tmp / 'gh').chmod(0o755)
            (tmp / 'sleep').write_text('#!/usr/bin/env bash\n:\n')
            (tmp / 'sleep').chmod(0o755)
            for name, line in runs.items():
                (tmp / name).write_text(line + '\n')
            env = {**os.environ, 'PATH': f'{tmp}{os.pathsep}{os.environ["PATH"]}', 'FAKE': str(tmp), 'REPO': 'o/r', 'PR': '755'}
            done = subprocess.run(['bash', '-c', SCRIPT], env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
            calls = (tmp / 'calls').read_text() if (tmp / 'calls').exists() else ''
            return [line for line in calls.split('\n') if 'rerun' in line]

    def test_a_red_gate_is_re_run_failed_only_then_the_aggregate(self):
        reruns = self.run_with({'replay': '11 completed failure', 'gate': '22 completed failure'})
        self.assertEqual(reruns, ['run rerun 11 -R o/r --failed', 'run rerun 22 -R o/r --failed'])

    def test_a_green_or_still_running_gate_is_left_alone(self):
        self.assertEqual(self.run_with({'replay': '11 completed success', 'gate': '22 completed success'}), [])
        self.assertEqual(self.run_with({'replay': '11 in_progress ', 'gate': '22 in_progress '}), [])
        self.assertEqual(self.run_with({'replay': '', 'gate': ''}), [])

    def test_the_aggregate_only_when_it_ended_red(self):
        self.assertEqual(self.run_with({'replay': '11 completed failure', 'gate': '22 in_progress '}), ['run rerun 11 -R o/r --failed'])


if __name__ == '__main__':
    unittest.main()
