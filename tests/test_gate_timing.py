"""tools/gate-timing.sh: the push gate times each step, keeps the command's exit code and output, and appends the run to the shared log."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / 'tools' / 'gate-timing.sh'


@unittest.skipUnless(shutil.which('bash') and shutil.which('git'), 'needs bash and git')
class GateTimingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        subprocess.run(['git', 'init', '-q', str(self.tmp)], check=True)

    def run_script(self, body, **env):
        return subprocess.run(['bash', '-c', f'source "{HELPER}"; gate_timing_start; {body}'], cwd=self.tmp,
                              capture_output=True, text=True, env={**os.environ, **env})

    def test_keeps_exit_code_output_and_logs_the_run(self):
        result = self.run_script('timed "slow step" bash -c "sleep 1; echo hi; exit 3"; echo "code=$?"; timed fast true; gate_summary "test gate"')
        self.assertIn('hi', result.stdout)
        self.assertIn('code=3', result.stdout)
        self.assertRegex(result.stderr, r'slow step\s+\(exit 3\)')
        lines = (self.tmp / '.git' / 'gate-timing.log').read_text().splitlines()
        self.assertTrue(lines[0].startswith('# '))
        self.assertIn('test gate', lines[0])
        self.assertTrue(any(line.endswith('slow step') and line.startswith('1 3 ') for line in lines))

    def test_off_switch_still_runs_the_command(self):
        result = self.run_script('timed x echo ran; gate_summary', GATE_TIMING='0')
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertFalse((self.tmp / '.git' / 'gate-timing.log').exists())

    def test_the_hook_has_one_exit_trap_that_prints_the_summary(self):
        # A second `trap ... EXIT` replaces the first: the summary vanished that way on the first landing (11 Oct 2026).
        traps = [line for line in (ROOT / 'tools' / 'pre-push-check.sh').read_text().splitlines() if line.startswith('trap ') and line.split('#')[0].rstrip().endswith('EXIT')]
        self.assertEqual(len(traps), 1)
        self.assertIn('gate_summary', traps[0])


if __name__ == '__main__':
    unittest.main()
