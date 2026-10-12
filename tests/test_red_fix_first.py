"""The landing of a red-main fix goes first (11 Oct 2026, the owner: someone who made a red main must not be blocked from fixing it by waiting for a lock): no landing queue, no check-slot wait, heavy-lock class `fix` above proof with no starvation cap."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.heavy_wait import wait_registered
from tests.ship_fixture import ShipFixture

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'tools' / 'heavy-lock.sh'
SLOT = ROOT / 'tools' / 'check-slot.sh'


class FixLandingTest(ShipFixture):
    def test_the_fix_skips_the_landing_queue_and_an_ordinary_landing_of_the_same_files_does_not(self):
        (self.tree / 'desktop' / 'lib').mkdir(parents=True)
        self.change(self.tree, 'desktop/lib/x.js', '1\n', 'Touch a slow-gate path')
        ordinary = self.ship()
        self.assertIn('queueing for the landing lock', ordinary.stdout)
        self.change(self.tree, 'desktop/lib/y.js', '2\n', 'Touch it again')
        fix = self.ship('--fix')
        self.assertEqual(fix.returncode, 0, fix.stdout + fix.stderr)
        self.assertNotIn('queueing for the landing lock', fix.stdout)


class CheckSlotFixTest(unittest.TestCase):
    def test_a_fix_runs_beside_the_others_while_an_ordinary_check_waits(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        env = {**os.environ, 'JOB_PILOTTO_CHECK_SLOT_DIR': (tmp / 'slots').as_posix(), 'JOB_PILOTTO_CHECK_SLOTS': '1', 'JOB_PILOTTO_CHECK_TIMING_LOG': (tmp / 't.log').as_posix()}
        env.pop('JOB_PILOTTO_RED_FIX', None)
        holder = subprocess.Popen(['bash', str(SLOT), 'sleep', '20'], env=env)
        self.addCleanup(holder.kill)
        deadline = time.monotonic() + 30
        while not list((tmp / 'slots').glob('slot*')) and time.monotonic() < deadline:
            time.sleep(0.05)
        fix = subprocess.run(['bash', str(SLOT), 'true'], env={**env, 'JOB_PILOTTO_RED_FIX': '1'}, capture_output=True, text=True, timeout=30)
        self.assertEqual(fix.returncode, 0)
        self.assertIsNone(holder.poll(), 'the slot holder still holds: the fix ran beside it, it did not wait')   # no stopwatch: a loaded runner is slow, not waiting
        self.assertIn('the fix of a red main: it does not wait for a slot', fix.stderr)
        ordinary = subprocess.Popen(['bash', str(SLOT), 'true'], env={**env, 'JOB_PILOTTO_CHECK_WAIT': '2'}, stderr=subprocess.PIPE, text=True)
        _, err = ordinary.communicate(timeout=30)
        self.assertIn('waiting for a free slot', err)


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockFixClassTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.trace = (self.tmp / 'trace').as_posix()
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOB_PILOTTO_HEAVY', 'JP_HEAVY', 'JOB_PILOTTO_RED'))}, 'JOB_PILOTTO_HEAVY_DIR': (self.tmp / 'heavy').as_posix(), 'JOB_PILOTTO_HEAVY_LOAD': '0',
                    'JOB_PILOTTO_HEAVY_POLL': '0.1', 'JOB_PILOTTO_HEAVY_TIMING_LOG': (self.tmp / 'gate-timing.log').as_posix(), 'JOB_PILOTTO_HEAVY_SHARED': str(LOCK), 'JOB_PILOTTO_HEAVY_SLOTS': '1'}

    def start(self, what, name, body=None, **env):
        return subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', body or f'echo {name} >> {self.trace}'], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def order(self, fix_env, **env):
        heavy, go = self.env['JOB_PILOTTO_HEAVY_DIR'], (self.tmp / 'go').as_posix()
        procs = [self.start('real-extension', 'holder', f'echo holder >> {self.trace}; while [ ! -f {go} ]; do sleep 0.1; done', **env)]
        wait_registered(heavy, 1)
        for what, name, extra in (('real-extension', 'proof', {}), ('e2e-smoke', 'pool', {})):
            procs.append(self.start(what, name, **{**env, **extra}))
            wait_registered(heavy, len(procs))
            time.sleep(0.2)
        procs.append(self.start('recorded-replay', 'fix', **{**env, **fix_env}))
        wait_registered(heavy, len(procs))
        Path(go).write_text('go')
        for p in procs:
            p.communicate(timeout=90)
        return Path(self.trace).read_text().split()

    def test_the_fix_goes_before_older_proof_and_pool_runs_even_past_the_starvation_cap(self):
        self.assertEqual(self.order({'JOB_PILOTTO_RED_FIX': '1'}), ['holder', 'fix', 'proof', 'pool'])
        self.tearDown(); self.setUp()
        self.assertEqual(self.order({'JOB_PILOTTO_HEAVY_CLASS': 'fix'}, JOB_PILOTTO_HEAVY_STARVE='0', JOB_PILOTTO_HEAVY_SHORT_AGE='0'), ['holder', 'fix', 'proof', 'pool'], 'no cap for the fix')

    def test_without_the_fix_marker_the_same_run_is_an_ordinary_proof(self):
        self.assertEqual(self.order({}), ['holder', 'proof', 'fix', 'pool'], 'a proof behind an older proof, ahead of the pool')


if __name__ == '__main__':
    unittest.main()
