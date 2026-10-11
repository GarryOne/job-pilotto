"""tools/heavy-lock.sh shortest first (11 Oct 2026): a row replay (~15 s) goes ahead of older longer waiters instead of waiting behind a ~70 s live run, a longer waiter yields to it,
replays wait for the memory gate and not the load, tickets and slots name their session. Nobody starves (JOB_PILOTTO_HEAVY_SHORT_AGE); JOB_PILOTTO_HEAVY_SHORT_FIRST=0 is strict arrival order. Base lock tests: test_heavy_lock.py."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.heavy_wait import wait_registered

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockShortFirstTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOB_PILOTTO_HEAVY', 'JP_HEAVY', 'JOB_PILOTTO_SESSION'))},
                    'JOB_PILOTTO_HEAVY_DIR': str(self.tmp / 'heavy'), 'JOB_PILOTTO_HEAVY_LOAD': '0', 'JOB_PILOTTO_HEAVY_POLL': '0.1',
                    'JOB_PILOTTO_HEAVY_TIMING_LOG': str(self.tmp / 'gate-timing.log'), 'JOB_PILOTTO_HEAVY_SHARED': str(LOCK), 'JOB_PILOTTO_HEAVY_SLOTS': '1'}
        self.trace = (self.tmp / 'trace').as_posix()

    def start(self, what, body, **env):
        return subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', body], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def order(self, **env):
        """A gated holder runs until a longer run (real-extension) and a row replay are queued; returns the order they ran in."""
        heavy, go = self.env['JOB_PILOTTO_HEAVY_DIR'], (self.tmp / 'go').as_posix()
        holder = self.start('recorded-replay-holder', f'echo holder >> {self.trace}; while [ ! -f {go} ]; do sleep 0.05; done', **env)
        wait_registered(heavy, 1)
        longer = self.start('real-extension', f'echo long >> {self.trace}', **env)
        wait_registered(heavy, 2)
        time.sleep(0.2)
        row = self.start('row-replay', f'echo row >> {self.trace}', **env)
        wait_registered(heavy, 3)
        Path(go).write_text('go')
        for p in (holder, longer, row):
            p.communicate(timeout=30)
        return Path(self.trace).read_text().split()

    def test_a_row_replay_goes_ahead_of_an_older_longer_waiter(self):
        self.assertEqual(self.order(), ['holder', 'row', 'long'])

    def test_strict_arrival_order_with_the_switch_off(self):
        self.assertEqual(self.order(JOB_PILOTTO_HEAVY_SHORT_FIRST='0'), ['holder', 'long', 'row'])

    def test_a_longer_waiter_that_has_waited_past_the_age_limit_is_not_overtaken(self):
        self.assertEqual(self.order(JOB_PILOTTO_HEAVY_SHORT_AGE='0'), ['holder', 'long', 'row'])

    def test_replays_wait_for_memory_not_load_and_a_live_run_still_waits_for_the_load(self):
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'uptime').write_text('#!/bin/sh\necho "10:00  up 1 day, load averages: 99.00 99.00 99.00"\n')
        (bin_dir / 'uptime').chmod(0o755)
        busy = {'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'JOB_PILOTTO_HEAVY_SIGNAL': 'load', 'JOB_PILOTTO_HEAVY_LOAD': '4', 'JOB_PILOTTO_HEAVY_LOAD_WAIT': '2'}
        for what in ('row-replay', 'row-try', 'recorded-replay'):
            _, err = self.start(what, 'true', **busy).communicate(timeout=30)
            self.assertNotIn('waits for the machine', err, what)
        _, err = self.start('e2e-smoke', 'true', **busy).communicate(timeout=30)
        self.assertIn('waits for the machine', err)
        _, err = self.start('row-replay', 'true', JOB_PILOTTO_HEAVY_REPLAY_LOAD='1', **busy).communicate(timeout=30)
        self.assertIn('waits for the machine', err, 'JOB_PILOTTO_HEAVY_REPLAY_LOAD=1 puts replays back behind the load wait')

    def test_the_wait_message_names_the_session_that_holds_the_lock_and_the_one_ahead(self):
        holder = self.start('e2e-smoke', 'sleep 1.5', JOB_PILOTTO_SESSION='session-a')
        time.sleep(0.4)
        waiter = self.start('e2e-smoke', 'true', JOB_PILOTTO_SESSION='session-b')
        _, err = waiter.communicate(timeout=30)
        holder.communicate(timeout=30)
        self.assertIn('session session-a', err)


if __name__ == '__main__':
    unittest.main()
