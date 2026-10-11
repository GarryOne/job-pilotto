"""tools/heavy-lock.sh admits by memory budget (11 Oct 2026): up to 4 runs at once, each only while free+inactive memory minus what the runs that just started are still to take is over the same floor as before (7 GB live, 3 GB replay), a replay with room does not queue behind a waiting live run, a timing run is alone. A fake vm_stat serves the memory."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.heavy_wait import wait_registered

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockBudgetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.trace = (self.tmp / 'trace').as_posix()
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOB_PILOTTO_HEAVY', 'JP_HEAVY'))}, 'JOB_PILOTTO_HEAVY_DIR': (self.tmp / 'heavy').as_posix(),
                    'JOB_PILOTTO_HEAVY_LOAD': '0', 'JOB_PILOTTO_HEAVY_POLL': '0.1', 'JOB_PILOTTO_HEAVY_TIMING_LOG': (self.tmp / 'gate-timing.log').as_posix(), 'JOB_PILOTTO_HEAVY_SHARED': str(LOCK)}

    def memory(self, free_gb, swap_used_pct=10):
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir(exist_ok=True)
        pages = int(free_gb * 1024 ** 3 / 16384 / 2)
        (bin_dir / 'vm_stat').write_text('#!/bin/sh\n' f'printf "Mach Virtual Memory Statistics: (page size of 16384 bytes)\\nPages free:  {pages}.\\nPages active:  999.\\nPages inactive:  {pages}.\\n"\n')
        (bin_dir / 'sysctl').write_text('#!/bin/sh\ncase "$*" in *swapusage*) ' f'echo "total = 4096.00M  used = {4096 * swap_used_pct / 100:.2f}M  free = 0.00M  (encrypted)";; *) echo 8;; esac\n')
        for name in ('vm_stat', 'sysctl'):
            (bin_dir / name).chmod(0o755)
        self.env['PATH'] = f'{bin_dir.as_posix()}{os.pathsep}{os.environ["PATH"]}'

    def start(self, what, name, nap='1.5', **env):
        return subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', f'echo +{name} >> {self.trace}; sleep {nap}; echo -{name} >> {self.trace}'],
                                env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def run_all(self, runs, gap=0.3, **env):
        """runs: [(what, name, nap)] started `gap` seconds apart; returns the trace: "+x" a start, "-x" an end."""
        procs = []
        for what, name, nap in runs:
            procs.append(self.start(what, name, nap, **env))
            wait_registered(self.env['JOB_PILOTTO_HEAVY_DIR'], len(procs))   # it is in the books (a loaded Mac may take a second to start it)
            time.sleep(gap)
        for p in procs:
            p.communicate(timeout=90)
        return Path(self.trace).read_text().split()

    def test_four_replays_run_at_once_when_the_budget_has_room(self):
        self.memory(free_gb=20)
        trace = self.run_all([('recorded-replay', n, '1.5') for n in 'abcd'])
        self.assertEqual(sorted(trace[:4]), ['+a', '+b', '+c', '+d'], trace)

    def test_a_third_live_run_waits_for_budget_a_replay_does_not(self):
        # 12 GB free: a 2nd live run needs 7 over the 2.9 GB reserved for the 1st (9.1), a 3rd 6.2 (waits); a replay needs 3 (6.2: goes)
        self.memory(free_gb=12)
        trace = self.run_all([('e2e-smoke', 'a', '2'), ('e2e-smoke', 'b', '2'), ('e2e-smoke', 'c', '1'), ('recorded-replay', 'd', '1')])
        self.assertEqual(sorted(trace[:3]), ['+a', '+b', '+d'], trace)
        self.assertLess(trace.index('-a'), trace.index('+c'), 'the 3rd live run starts only after one of the first two ended')

    def test_the_floors_are_not_weakened_a_live_run_still_needs_seven_gb(self):
        self.memory(free_gb=9)    # 9 - 2.9 reserved for the 1st = 6.1: under 7
        trace = self.run_all([('e2e-smoke', 'a', '1.5'), ('e2e-smoke', 'b', '1')])
        self.assertEqual(trace[:2], ['+a', '-a'], trace)

    def test_a_replay_with_room_does_not_queue_behind_a_waiting_live_run_and_the_switch_restores_the_order(self):
        self.memory(free_gb=6)     # a live run cannot start beside the 1st (needs 7); a replay can (6 - 2.9 = 3.1 over 3)
        runs = [('e2e-smoke', 'a', '2'), ('real-extension', 'b', '1'), ('recorded-replay', 'c', '1')]   # b: a live proof of the same class, waiting for memory
        trace = self.run_all(runs)
        self.assertEqual(sorted(trace[:2]), ['+a', '+c'], trace)
        self.tearDown(); self.setUp(); self.memory(free_gb=6)
        trace = self.run_all(runs, JOB_PILOTTO_HEAVY_REPLAY_SKIP='0')
        self.assertLess(trace.index('+b'), trace.index('+c'), trace)

    def test_a_timing_run_is_alone_and_nobody_starts_beside_it(self):
        self.memory(free_gb=20)
        trace = self.run_all([('recorded-replay', 'a', '1.5'), ('apply-latency-x', 'timing', '1.5'), ('recorded-replay', 'b', '1')])
        self.assertEqual(trace[:2], ['+a', '-a'], 'the timing run waits for the empty lock')
        self.assertEqual(trace[2:4], ['+timing', '-timing'], 'and nothing starts beside it')

    def test_the_slot_cap_can_be_set_back_to_two(self):
        self.memory(free_gb=20)
        trace = self.run_all([('recorded-replay', n, '1.5') for n in 'abc'], JOB_PILOTTO_HEAVY_SLOTS='2')
        self.assertEqual(sorted(trace[:2]), ['+a', '+b'], trace)
        self.assertLess(trace.index('-a'), trace.index('+c'), trace)


if __name__ == '__main__':
    unittest.main()
