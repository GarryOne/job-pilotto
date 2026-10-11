"""tools/landing-lock.sh: landings queue in arrival order on one Mac; a dead landing is dropped; the wait has a limit and an off switch."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'tools' / 'landing-lock.sh'


@unittest.skipUnless(shutil.which('bash') and shutil.which('git'), 'needs bash and git')
class LandingLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        subprocess.run(['git', 'init', '-q', str(self.tmp)], check=True)
        self.trace = self.tmp / 'trace'

    def landing(self, label, hold, **env):
        body = f'source "{LOCK}"; landing_acquire {label}; echo "{label} in" >> "{self.trace}"; sleep {hold}; echo "{label} out" >> "{self.trace}"; landing_release'
        return subprocess.Popen(['bash', '-c', body], cwd=self.tmp, env={**os.environ, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def test_landings_run_one_at_a_time_in_arrival_order(self):
        first = self.landing('first', 2)
        time.sleep(0.5)
        second = self.landing('second', 0)
        time.sleep(0.5)
        third = self.landing('third', 0)
        _, err = third.communicate(timeout=30)
        second.communicate(timeout=30)
        first.communicate(timeout=30)
        self.assertEqual(self.trace.read_text().split('\n')[:-1], ['first in', 'first out', 'second in', 'second out', 'third in', 'third out'])
        self.assertIn('waiting for the landing of', err)
        self.assertIn('first', err)

    def test_a_dead_landing_ahead_is_dropped(self):
        queue = self.tmp / '.git' / 'landing-queue'
        queue.mkdir()
        (queue / '1-999999').write_text('999999 crashed\n')
        done = self.landing('next', 0)
        done.communicate(timeout=30)
        self.assertEqual(self.trace.read_text().split('\n')[:-1], ['next in', 'next out'])
        self.assertEqual(list(queue.iterdir()), [], 'the dead ticket and the finished one are gone')

    def test_the_wait_has_a_limit_and_an_off_switch(self):
        holder = self.landing('holder', 6)
        time.sleep(0.5)
        impatient = self.landing('impatient', 0, SHIP_LANDING_WAIT='2')
        _, err = impatient.communicate(timeout=30)
        self.assertIn('landing anyway', err)
        off = self.landing('off', 0, SHIP_LANDING_LOCK='0')
        off.communicate(timeout=10)
        holder.communicate(timeout=30)
        self.assertIn('off in', self.trace.read_text())

    def test_ship_sh_queues_only_when_asked_and_releases(self):
        ship = (ROOT / 'tools' / 'ship.sh').read_text()
        self.assertIn('if [ "${SHIP_LANDING_LOCK:-0}" = 1 ]; then', ship, 'no landing queue by default (owner, 11 Oct 2026)')
        self.assertLess(ship.index('landing_acquire "$branch"'), ship.index('rebase\n[ "$(git rev-list'), 'when asked, queued before the first rebase')
        self.assertIn('landing_release;', ship)   # in the exit trap

    def test_a_refused_push_is_checked_again_before_it_is_pushed(self):
        # Without a queue two landings can cross: what reaches main must be checked on top of what just landed, never pushed untested.
        ship = (ROOT / 'tools' / 'ship.sh').read_text()
        retry = ship[ship.index('for attempt in 1 2 3 4 5; do'):ship.index('done', ship.index('for attempt in 1 2 3 4 5; do'))]
        self.assertLess(retry.index('rebase'), retry.index('run_checks'), 'rebase, then the checks, then the next push')
        self.assertIn('take_extension_version', ship[ship.index('rebase() {'):ship.index('}', ship.index('rebase() {') + 400)], 'the retry re-takes the version')
        self.assertIn('[ "$attempt" -lt 5 ] || break', retry, 'the last refused push does not rebase and re-check for nothing')

    def test_a_wait_is_logged_for_the_next_measurement(self):
        first = self.landing('first', 2)
        time.sleep(0.5)
        self.landing('second', 0).communicate(timeout=30)
        first.communicate(timeout=30)
        log = (self.tmp / '.git' / 'gate-timing.log').read_text()
        self.assertRegex(log, r'landing queue wait=\d+s label=second')


if __name__ == '__main__':
    unittest.main()
