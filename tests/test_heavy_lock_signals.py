"""tools/heavy-lock.sh busy-machine signals (11 Oct 2026): every hold logs the CPU in use and the free memory percentage beside the load; JOB_PILOTTO_HEAVY_SIGNAL=cpu|memory gates live runs on that reading instead of the 1-minute load. Fake ps, uptime and memory_pressure on PATH."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockSignalsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.log = self.tmp / 'gate-timing.log'
        self.bin = self.tmp / 'bin'
        self.bin.mkdir()
        real_ps = shutil.which('ps')
        self.fake('ps', f'if [ "$*" = "-Ao pcpu=" ]; then echo " $CPU_TOTAL"; elif [ "$*" = "-Ao pcpu=,comm=" ]; then echo " $CPU_TOTAL /bin/work"; else exec {real_ps} "$@"; fi')
        self.fake('uptime', 'echo "10:00  up 1 day, load averages: $LOAD $LOAD $LOAD"')
        self.fake('memory_pressure', 'echo "System-wide memory free percentage: $MEM_FREE%"')
        self.fake('sysctl', 'case "$*" in *hw.ncpu*) echo 8;; *swapusage*) echo "total = 0.00M  used = 0.00M  free = 0.00M";; esac')
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOB_PILOTTO_HEAVY', 'JP_HEAVY'))}, 'PATH': f'{self.bin.as_posix()}{os.pathsep}{os.environ["PATH"]}',
                    'JOB_PILOTTO_HEAVY_DIR': (self.tmp / 'heavy').as_posix(), 'JOB_PILOTTO_HEAVY_SHARED': str(LOCK), 'JOB_PILOTTO_HEAVY_TIMING_LOG': self.log.as_posix(),
                    'JOB_PILOTTO_HEAVY_POLL': '0.1', 'JOB_PILOTTO_HEAVY_LOAD_WAIT': '1', 'JOB_PILOTTO_HEAVY_SLOTS': '1', 'CPU_TOTAL': '400', 'LOAD': '2', 'MEM_FREE': '60'}

    def fake(self, name, body):
        (self.bin / name).write_text('#!/bin/sh\n' + body + '\n')
        (self.bin / name).chmod(0o755)

    def run_lock(self, **env):
        return subprocess.run(['bash', str(LOCK), 'e2e-smoke', 'true'], env={**self.env, **env}, capture_output=True, text=True, timeout=60)

    def test_every_hold_logs_the_cpu_in_use_and_the_free_memory_percentage(self):
        self.run_lock()
        line = [l for l in self.log.read_text().splitlines() if 'heavy lock run=' in l][-1]
        self.assertIn('cpu_busy=50', line)        # 400 % of 8 cores
        self.assertIn('mem_free=60', line)

    def test_the_default_signal_is_the_load_average(self):
        calm = self.run_lock(CPU_TOTAL='790', MEM_FREE='5', LOAD='2')
        self.assertNotIn('waits for the machine', calm.stderr, 'the load is low: the busy CPU and low memory do not hold a run')
        busy = self.run_lock(LOAD='99', JOB_PILOTTO_HEAVY_LOAD='8')
        self.assertIn('1-minute load 99 is above 8', busy.stderr)

    def test_the_cpu_signal_waits_on_cpu_in_use_not_on_load(self):
        busy = self.run_lock(JOB_PILOTTO_HEAVY_SIGNAL='cpu', JOB_PILOTTO_HEAVY_LOAD='8', CPU_TOTAL='760', LOAD='2')
        self.assertIn('CPU in use 95% of 8 cores', busy.stderr)
        calm = self.run_lock(JOB_PILOTTO_HEAVY_SIGNAL='cpu', JOB_PILOTTO_HEAVY_LOAD='8', CPU_TOTAL='100', LOAD='99')
        self.assertNotIn('waits for the machine', calm.stderr)

    def test_the_memory_signal_waits_on_free_memory_percentage(self):
        busy = self.run_lock(JOB_PILOTTO_HEAVY_SIGNAL='memory', JOB_PILOTTO_HEAVY_LOAD='8', MEM_FREE='8', LOAD='1')
        self.assertIn('free memory 8% (busy below 15%)', busy.stderr)
        calm = self.run_lock(JOB_PILOTTO_HEAVY_SIGNAL='memory', JOB_PILOTTO_HEAVY_LOAD='8', MEM_FREE='40', LOAD='99')
        self.assertNotIn('waits for the machine', calm.stderr)


if __name__ == '__main__':
    unittest.main()
