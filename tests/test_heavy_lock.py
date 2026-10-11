"""tools/heavy-lock.sh: one heavy run per machine (a 2nd beside it only when memory allows, never a 3rd),
in arrival order, through the primary checkout's copy (a run that re-asks never jumps a waiter), stale locks and dead waiters
dropped, a busy machine waited out, every wait logged, every escape hatch said in the log."""
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
class HeavyLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOB_PILOTTO_HEAVY', 'JP_HEAVY'))},
                    'JOB_PILOTTO_HEAVY_DIR': str(self.tmp / 'heavy'), 'JOB_PILOTTO_HEAVY_LOAD': '0',
                    'JOB_PILOTTO_HEAVY_TIMING_LOG': str(self.tmp / 'gate-timing.log'),
                    'JOB_PILOTTO_HEAVY_SHARED': str(LOCK),   # this file IS the copy under test: never hand off to the primary checkout's
                    'JOB_PILOTTO_HEAVY_SLOTS': '1'}          # one at a time unless a test opens the memory-gated 2nd slot

    def memory(self, free_gb, swap_used_pct):
        """Fake vm_stat and sysctl on PATH: free+inactive memory and swap use as given; returns the env for a 2-slot run."""
        bin_dir = self.tmp / f'bin-{free_gb}-{swap_used_pct}'
        bin_dir.mkdir()
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

    def test_keeps_exit_code_and_tells_the_child_the_lock_is_held(self):
        result = self.run_lock('suite', 'bash', '-c', 'echo "held=$JP_HEAVY_HELD"; exit 5')
        self.assertEqual(result.returncode, 5)
        self.assertRegex(result.stdout, r'held=\d+')
        self.assertFalse((self.tmp / 'heavy' / 'lock').exists(), 'freed afterwards')

    def test_two_runs_never_overlap_and_the_second_says_who_holds_it(self):
        trace = self.tmp / 'trace'
        body = f'echo start >> {trace}; sleep 2; echo end >> {trace}'
        first = self.start('first suite', 'bash', '-c', body)
        time.sleep(0.7)
        second = self.start('second suite', 'bash', '-c', body)
        _, err = second.communicate(timeout=30)
        first.communicate(timeout=30)
        self.assertEqual(trace.read_text().split(), ['start', 'end', 'start', 'end'])
        self.assertIn('second suite waits: the lock is held by', err)
        self.assertIn('first suite', err)

    def test_a_stale_lock_is_taken_over(self):
        lock = self.tmp / 'heavy' / 'lock'
        lock.mkdir(parents=True)
        (lock / 'pid').write_text('999999')
        (lock / 'what').write_text('crashed run')
        result = self.run_lock('next', 'echo', 'ran')
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('taking over a stale lock: crashed run', result.stderr)

    def test_waiting_has_a_limit_and_runs_anyway_saying_so(self):
        holder = self.start('holder', 'sleep', '8')
        time.sleep(0.7)
        result = self.run_lock('impatient', 'echo', 'ran', JOB_PILOTTO_HEAVY_WAIT='2')
        holder.kill()
        holder.communicate()
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('running anyway', result.stderr)

    def test_a_nested_call_and_the_off_switch_run_at_once(self):
        holder = self.start('holder', 'sleep', '5')
        time.sleep(0.7)
        for env in ({'JP_HEAVY_HELD': '1'}, {'JOB_PILOTTO_HEAVY': '0'}):
            self.assertEqual(self.run_lock('inner', 'echo', 'ran', **env).stdout.strip(), 'ran')
        holder.kill()
        holder.communicate()

    def test_a_busy_machine_is_waited_for_then_run_anyway(self):
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'uptime').write_text('#!/bin/sh\necho "10:00  up 1 day,  3 users,  load averages: 99.00 90.00 80.00"\n')
        (bin_dir / 'uptime').chmod(0o755)
        result = self.run_lock('browser suite', 'echo', 'ran', PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}',
                               JOB_PILOTTO_HEAVY_LOAD='8', JOB_PILOTTO_HEAVY_LOAD_WAIT='2')
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('waits for the machine: 1-minute load 99 is above 8', result.stderr)
        self.assertIn('running browser suite anyway', result.stderr)

    def ticket(self, pid, what, age_ns=10**9):
        """A waiter's place in the queue, older than anything this test starts next."""
        queue = self.tmp / 'heavy' / 'queue'
        queue.mkdir(parents=True, exist_ok=True)
        path = queue / f'{time.time_ns() - age_ns}-{pid}'
        path.write_text(f'{pid} {what}\n')
        return path

    def test_an_earlier_waiter_goes_first_even_when_the_lock_is_free(self):
        # 11 Oct 2026: the pool's per-site runs re-took a just-freed lock while a replay had waited 6+ min. Arrival order decides, not who polls next.
        waiter = subprocess.Popen(['sleep', '60'])
        self.addCleanup(waiter.kill)
        self.ticket(waiter.pid, 'replay that waited')
        late = self.start('pool site', 'echo', 'ran')
        time.sleep(2)
        self.assertIsNone(late.poll(), 'the later run waits while the earlier waiter lives, though the lock is free')
        waiter.kill(); waiter.wait()   # reaped: a zombie still answers kill -0
        out, err = late.communicate(timeout=30)
        self.assertEqual(out.strip(), 'ran')
        self.assertIn('pool site waits: replay that waited', err)

    def test_a_dead_waiter_is_dropped_from_the_queue(self):
        dead = self.ticket(999999, 'crashed waiter')
        began = time.monotonic()
        result = self.run_lock('next', 'echo', 'ran')
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertLess(time.monotonic() - began, 2, 'a dead waiter holds nobody up')
        self.assertFalse(dead.exists(), 'its ticket is removed')
        self.assertEqual(list((self.tmp / 'heavy' / 'queue').iterdir()), [], 'no ticket is left behind, mine included')

    def test_a_wait_is_logged_for_the_next_measurement(self):
        holder = self.start('holder', 'sleep', '2')
        time.sleep(0.7)
        result = self.run_lock('second', 'echo', 'ran')
        holder.communicate(timeout=30)
        self.assertIn('got the lock after', result.stderr)
        self.assertRegex((self.tmp / 'gate-timing.log').read_text(), r'heavy lock wait=\d+s what=second')

    def overlap(self, **env):
        """Starts a 3 s holder, then a second run; True when the second ran while the holder still ran."""
        holder = self.start('pool run', 'sleep', '3', **env)
        self.addCleanup(holder.kill)
        time.sleep(0.7)
        began = time.monotonic()
        result = self.run_lock('replay', 'echo', 'ran', **env)
        took = time.monotonic() - began   # before waiting out the holder
        holder.communicate(timeout=30)
        self.assertEqual(result.stdout.strip(), 'ran')
        return took < 1.5, result.stderr

    def test_a_second_run_starts_beside_the_first_when_memory_allows(self):
        beside, _ = self.overlap(**self.memory(free_gb=12, swap_used_pct=10))
        self.assertTrue(beside, '12 GB free+inactive and little swap: the 2nd run starts at once')

    def test_a_second_run_waits_when_memory_is_short_or_swap_is_high(self):
        for free_gb, swap, why in ((5, 10, 'free+inactive'), (12, 80, 'swap')):
            beside, err = self.overlap(**self.memory(free_gb=free_gb, swap_used_pct=swap))
            self.assertFalse(beside, f'{free_gb} GB, swap {swap}%: the 2nd run waits')
            self.assertIn(why, err, 'the wait says which memory check held it')

    def test_never_a_third_heavy_run(self):
        env = self.memory(free_gb=30, swap_used_pct=0)
        first, second = self.start('first', 'sleep', '3', **env), None
        self.addCleanup(first.kill)
        time.sleep(0.7)
        second = self.start('second', 'sleep', '3', **env)
        self.addCleanup(second.kill)
        time.sleep(0.7)
        began = time.monotonic()
        result = self.run_lock('third', 'echo', 'ran', **env)
        first.communicate(timeout=30); second.communicate(timeout=30)
        self.assertGreaterEqual(time.monotonic() - began, 1, 'the third waited for a slot')
        self.assertIn('third waits', result.stderr)

    def test_a_worktree_copy_hands_off_to_the_primary_checkouts_copy(self):
        # Owner, 11 Oct 2026: every session queues in ONE fair order, so every copy runs the primary checkout's script, never its own worktree's.
        primary = self.tmp / 'primary'
        (primary / 'tools').mkdir(parents=True)
        (primary / 'tools' / 'heavy-lock.sh').write_text('echo "primary copy: $*"\n')
        git = lambda *args, cwd=primary: subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True)
        git('init', '-q'); git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x')
        git('worktree', 'add', '-q', str(self.tmp / 'wt'))
        mine = self.tmp / 'wt' / 'tools' / 'heavy-lock.sh'
        mine.write_text(LOCK.read_text())
        env = {k: v for k, v in self.env.items() if k != 'JOB_PILOTTO_HEAVY_SHARED'}
        result = subprocess.run(['bash', str(mine), 'suite', 'echo', 'hi'], env=env, capture_output=True, text=True, cwd=self.tmp / 'wt')
        self.assertEqual(result.stdout.strip(), 'primary copy: suite echo hi')
        result = subprocess.run(['bash', str(mine), 'suite', 'echo', 'hi'], env=env, capture_output=True, text=True, cwd='/')
        self.assertEqual(result.stdout.strip(), 'primary copy: suite echo hi', 'found from the script, not the caller\'s folder')

    def test_the_e2e_package_scripts_that_open_browsers_take_the_lock(self):
        scripts = (ROOT / 'desktop' / 'e2e' / 'package.json').read_text()
        for name in ('real-extension', 'recorded'):
            line = next(l for l in scripts.splitlines() if f'"{name}"' in l)
            self.assertIn('heavy-lock.sh', line, name)


if __name__ == '__main__':
    unittest.main()
