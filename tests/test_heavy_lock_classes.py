"""tools/heavy-lock.sh priority classes (11 Oct 2026): a proof that blocks a landing goes before the pool's and exploratory runs, each waiter that is overtaken only while it has waited under a cap; the class comes from the `what` name or JOB_PILOTTO_HEAVY_CLASS and is logged. Shortness inside a class: test_heavy_lock_short_first.py."""
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
class HeavyLockClassesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.log = self.tmp / 'gate-timing.log'
        self.trace = (self.tmp / 'trace').as_posix()
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOB_PILOTTO_HEAVY', 'JP_HEAVY'))}, 'JOB_PILOTTO_HEAVY_DIR': (self.tmp / 'heavy').as_posix(),
                    'JOB_PILOTTO_HEAVY_LOAD': '0', 'JOB_PILOTTO_HEAVY_POLL': '0.1', 'JOB_PILOTTO_HEAVY_TIMING_LOG': self.log.as_posix(), 'JOB_PILOTTO_HEAVY_SHARED': str(LOCK),
                    'JOB_PILOTTO_HEAVY_SLOTS': '1'}

    def start(self, what, name, nap='0.2', **env):
        return subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', f'echo {name} >> {self.trace}; sleep {nap}'], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def order(self, waiters, **env):
        """A holder runs 2 s; the waiters queue in the order given as (what, name, extra env); returns the run order."""
        procs = [self.start('real-extension', 'holder', '2', **env)]
        wait_registered(self.env['JOB_PILOTTO_HEAVY_DIR'], 1)
        for what, name, extra in waiters:
            procs.append(self.start(what, name, **{**env, **extra}))
            wait_registered(self.env['JOB_PILOTTO_HEAVY_DIR'], len(procs))
            time.sleep(0.2)
        for p in procs:
            p.communicate(timeout=60)
        return Path(self.trace).read_text().split()

    def test_a_proof_goes_ahead_of_older_pool_and_explore_runs(self):
        self.assertEqual(self.order([('e2e-smoke', 'pool', {}), ('discover-1', 'explore', {}), ('real-extension', 'proof', {})]), ['holder', 'proof', 'pool', 'explore'])

    def test_the_pool_goes_ahead_of_older_exploration(self):
        self.assertEqual(self.order([('discover-1', 'explore', {}), ('e2e-smoke', 'pool', {})]), ['holder', 'pool', 'explore'])

    def test_the_class_can_be_set_by_the_caller_not_just_by_the_name(self):
        waiters = [('e2e-smoke', 'pool', {}), ('e2e-smoke', 'held-row', {'JOB_PILOTTO_HEAVY_CLASS': 'proof'})]
        self.assertEqual(self.order(waiters), ['holder', 'held-row', 'pool'])

    def test_a_waiter_past_the_starvation_cap_is_not_overtaken_and_the_switch_gives_arrival_order(self):
        waiters = [('e2e-smoke', 'pool', {}), ('real-extension', 'proof', {})]
        self.assertEqual(self.order(waiters, JOB_PILOTTO_HEAVY_STARVE='0'), ['holder', 'pool', 'proof'])
        self.tearDown(); self.setUp()
        self.assertEqual(self.order(waiters, JOB_PILOTTO_HEAVY_CLASSES='0'), ['holder', 'pool', 'proof'])

    def test_the_class_is_logged_with_every_hold(self):
        self.start('row-replay', 'x').communicate(timeout=30)
        self.start('e2e-smoke', 'y', JOB_PILOTTO_HEAVY_CLASS='proof').communicate(timeout=30)
        lines = [l for l in self.log.read_text().splitlines() if 'heavy lock run=' in l]
        self.assertIn('class=proof', lines[0])
        self.assertIn('what=e2e-smoke class=proof', lines[1])


if __name__ == '__main__':
    unittest.main()
