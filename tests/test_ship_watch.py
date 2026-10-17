"""tools/ship-watch.sh (18 Oct 2026): after `ship: REVIEW` a detached watcher adds MERGED / CLOSED / RED / WATCH ENDED to ship's log, so a session learns of the owner's merge.
A fake `gh` reads its answers from files: state.txt (OPEN|MERGED|CLOSED, then an optional sha) and checks.txt (the failing check name or empty); a script of steps may rewrite them between looks."""
import os
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAKE = """#!/bin/sh
d="$FAKE_GH_DIR"; n=$(cat "$d/looks" 2>/dev/null || echo 0)
case "$1 $2" in
  "pr view") n=$((n + 1)); echo $n > "$d/looks"; s=$(sed -n "${n}p" "$d/states"); [ -n "$s" ] || s=$(tail -n 1 "$d/states")
             set -- $s; if [ "$1" = MERGED ]; then echo "{\\"state\\":\\"MERGED\\",\\"mergeCommit\\":{\\"oid\\":\\"$2\\"}}"; else echo "{\\"state\\":\\"$1\\",\\"mergeCommit\\":null}"; fi ;;
  "pr checks") c=$(sed -n "${n}p" "$d/checks" 2>/dev/null); if [ -n "$c" ]; then echo "[{\\"name\\":\\"$c\\",\\"bucket\\":\\"fail\\"}]"; else echo '[{"name":"x","bucket":"pass"}]'; fi ;;
esac
"""


@unittest.skipUnless(shutil.which('jq') and shutil.which('bash'), 'needs jq and bash')
class ShipWatchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        (self.tmp / 'bin').mkdir()
        gh = self.tmp / 'bin' / 'gh'
        gh.write_text(FAKE)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        self.log, self.pidfile = self.tmp / 'ship.log', self.tmp / 'watch.pid'
        self.log.write_text('ship: REVIEW #7 https://example.test/pull/7\n')

    def watch(self, states, checks='', cap=60, poll=0):
        (self.tmp / 'states').write_text(states)
        (self.tmp / 'checks').write_text(checks)
        (self.tmp / 'looks').write_text('0')
        env = {**os.environ, 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp), 'SHIP_WATCH_POLL': str(poll), 'SHIP_WATCH_CAP': str(cap)}
        subprocess.run(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile)], env=env, timeout=30, check=True)
        return self.log.read_text().splitlines()[1:]

    def test_open_then_merged_reports_the_merge_commit_and_stops(self):
        self.assertEqual(self.watch('OPEN\nOPEN\nMERGED abc1234def\n'), ['ship: MERGED #7 abc1234'])
        self.assertFalse(self.pidfile.exists(), 'the pid file goes with the watcher')

    def test_open_then_closed_says_unmerged(self):
        self.assertEqual(self.watch('OPEN\nCLOSED\n'), ['ship: CLOSED #7 (unmerged)'])

    def test_a_check_turning_red_is_reported_once_and_watching_goes_on_to_the_merge(self):
        lines = self.watch('OPEN\nOPEN\nOPEN\nOPEN\nMERGED fff0000\n', checks='\npython\npython\n\n')
        self.assertEqual(lines, ['ship: RED #7 python', 'ship: MERGED #7 fff0000'])

    def test_a_pr_still_open_at_the_cap_ends_the_watch(self):
        self.assertEqual(self.watch('OPEN\n', cap=2, poll=1), ['ship: WATCH ENDED #7 (still open)'])

    def test_a_second_watcher_replaces_the_first_by_pid_file(self):
        env = {**os.environ, 'PATH': f'{self.tmp / "bin"}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH_DIR': str(self.tmp), 'SHIP_WATCH_POLL': '1', 'SHIP_WATCH_CAP': '60'}
        (self.tmp / 'states').write_text('OPEN\n')
        first = subprocess.Popen(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile)], env=env)
        self.addCleanup(lambda: first.poll() is None and first.kill())
        for _ in range(50):
            if self.pidfile.exists(): break
            time.sleep(0.1)
        second = subprocess.Popen(['bash', str(ROOT / 'tools' / 'ship-watch.sh'), '7', str(self.log), str(self.pidfile)], env=env)
        self.addCleanup(lambda: second.poll() is None and second.kill())
        first.wait(timeout=10)   # killed by the second
        self.assertIsNotNone(first.returncode)
        self.assertIsNone(second.poll(), 'only the newest watcher keeps running')
        self.assertEqual(self.pidfile.read_text().strip(), str(second.pid))


if __name__ == '__main__':
    unittest.main()
