"""The shared fixture of the tools/heavy-lock.sh tests that wait on each other (not a test module): a private lock folder, a fake vm_stat/sysctl for the memory gate, and start/run helpers.
Used by test_heavy_lock.py (queue, stale locks, load wait, hand-off) and test_heavy_lock_memory.py (the memory gate). The newer lock tests (classes, budget, yield...) carry their own small setUp."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'tools' / 'heavy-lock.sh'



@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOB_PILOTTO_HEAVY', 'JP_HEAVY'))},
                    'JOB_PILOTTO_HEAVY_DIR': str(self.tmp / 'heavy'), 'JOB_PILOTTO_HEAVY_LOAD': '0', 'JOB_PILOTTO_HEAVY_POLL': '0.1',   # the script looks at the queue every 0.1 s here, not every second
                    'JOB_PILOTTO_HEAVY_TIMING_LOG': str(self.tmp / 'gate-timing.log'),
                    'JOB_PILOTTO_HEAVY_SHARED': str(LOCK),   # this file IS the copy under test: never hand off to the primary checkout's
                    'JOB_PILOTTO_HEAVY_SLOTS': '1',         # one at a time unless a test opens the memory-gated 2nd slot
                    'JOB_PILOTTO_HEAVY_RAMP': '0'}           # these tests check the floors only; tests/test_heavy_lock_budget.py checks the reservation of a run that just started

    def memory(self, free_gb, swap_used_pct):
        """Fake vm_stat and sysctl on PATH: free+inactive memory and swap use as given; returns the env for a 2-slot run."""
        bin_dir = self.tmp / f'bin-{free_gb}-{swap_used_pct}'
        bin_dir.mkdir(exist_ok=True)
        pages = int(free_gb * 1024 ** 3 / 16384 / 2)
        (bin_dir / 'vm_stat').write_text('#!/bin/sh\n' f'printf "Mach Virtual Memory Statistics: (page size of 16384 bytes)\\nPages free:  {pages}.\\nPages active:  999.\\nPages inactive:  {pages}.\\n"\n')
        (bin_dir / 'sysctl').write_text('#!/bin/sh\ncase "$*" in *swapusage*) ' f'echo "total = 4096.00M  used = {4096 * swap_used_pct / 100:.2f}M  free = 0.00M  (encrypted)";; *) echo 8;; esac\n')
        for name in ('vm_stat', 'sysctl'):
            (bin_dir / name).chmod(0o755)
        return {'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'JOB_PILOTTO_HEAVY_SLOTS': '2'}

    def start(self, what, *command, **env):
        return subprocess.Popen(['bash', str(LOCK), what, *command], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def run_lock(self, what, *command, **env):
        return subprocess.run(['bash', str(LOCK), what, *command], env={**self.env, **env}, capture_output=True, text=True)
