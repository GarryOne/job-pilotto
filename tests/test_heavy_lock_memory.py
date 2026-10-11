"""tools/heavy-lock.sh, 2 of 2 (the memory gate): a 2nd run beside the first only when free+inactive memory and swap allow (a replay by its real cost), never a 3rd on the old 2-slot setting. Fixture: heavy_lock_fixture.py."""
import concurrent.futures
import subprocess
import time
import unittest

from tests.heavy_lock_fixture import HeavyLockFixture, LOCK


class HeavyLockMemoryTest(HeavyLockFixture):
    def overlap(self, second='replay', heavy_dir='heavy', **env):
        """Starts a gated holder (it runs until released), then a second run; True when the second ran while the holder still ran. heavy_dir: its own lock folder, so scenarios can run side by side."""
        env = {**env, 'JOB_PILOTTO_HEAVY_DIR': str(self.tmp / heavy_dir)}
        go = self.tmp / f'go-{heavy_dir}'
        holder = self.start('pool run', 'bash', '-c', f'while [ ! -f {go.as_posix()} ]; do sleep 0.05; done', **env)
        self.addCleanup(holder.kill)
        deadline = time.monotonic() + 30
        while not (self.tmp / heavy_dir / 'lock' / 'what').exists() and time.monotonic() < deadline:   # the holder holds: not a guess of how long a loaded Mac takes to start it
            time.sleep(0.05)
        err_file = self.tmp / f'err-{heavy_dir}'
        with open(err_file, 'w') as err_out:
            second_run = subprocess.Popen(['bash', str(LOCK), second, 'echo', 'ran'], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=err_out, text=True)
            # Beside the holder = it ran while the holder was still held; not beside = it says it waits. Whichever comes first, however slow the Mac: no clock decides.
            deadline = time.monotonic() + 60
            while second_run.poll() is None and 'waits' not in err_file.read_text() and time.monotonic() < deadline:
                time.sleep(0.05)
            beside = second_run.poll() is not None
            go.write_text('go')   # let the holder end; a waiting second run then goes
            out, _ = second_run.communicate(timeout=60)
        err = err_file.read_text()
        holder.communicate(timeout=30)
        self.assertEqual(out.strip(), 'ran')
        return beside, err

    def overlaps(self, scenarios):
        """[(second run's name, env)] -> [(beside, stderr)]: every scenario in its own lock folder, all at once (3 s in all, not 3 s each)."""
        with concurrent.futures.ThreadPoolExecutor(len(scenarios)) as pool:
            return [future.result() for future in [pool.submit(self.overlap, second, f'heavy-{n}', **env) for n, (second, env) in enumerate(scenarios)]]

    def test_a_second_run_starts_beside_the_first_when_memory_allows(self):
        beside, _ = self.overlap(**self.memory(free_gb=12, swap_used_pct=10))
        self.assertTrue(beside, '12 GB free+inactive and little swap: the 2nd run starts at once')

    def test_a_second_run_waits_when_memory_is_short_or_swap_is_high(self):
        cases = ((5, 10, 'free+inactive'), (12, 80, 'swap'))
        for (free_gb, swap, why), (beside, err) in zip(cases, self.overlaps([('replay', self.memory(free_gb=free_gb, swap_used_pct=swap)) for free_gb, swap, _ in cases])):
            self.assertFalse(beside, f'{free_gb} GB, swap {swap}%: the 2nd run waits')
            self.assertIn(why, err, 'the wait says which memory check held it')

    def test_a_recorded_replay_is_counted_by_its_real_cost_beside_a_pool_run(self):
        # 11 Oct 2026: a replay is ~1.5 GB (4 tabs in one browser; 2.1 GB at 6), a pool run ~3.3 GB: it needs 3 GB free and swap up to 70%, not 7 GB and 50%
        runs = (('recorded-replay', 5, 60, True), ('recorded-replay', 2, 10, False), ('recorded-replay', 5, 85, False), ('row-replay', 5, 60, True), ('some pool run', 5, 60, False))
        results = self.overlaps([(what, self.memory(free_gb=free_gb, swap_used_pct=swap)) for what, free_gb, swap, _ in runs])
        for (what, free_gb, swap, expected), (beside, err) in zip(runs, results):
            self.assertEqual(beside, expected, f'{what} with {free_gb} GB free, swap {swap}%: {err}')   # a row replay (one offline browser, ~1 GB) counts like a recorded replay; any other run keeps the 7 GB / 50% rule

    def test_never_a_third_heavy_run(self):
        env = self.memory(free_gb=30, swap_used_pct=0)
        go = (self.tmp / 'go').as_posix()
        hold = f'while [ ! -f {go} ]; do sleep 0.05; done'
        first, second = self.start('first', 'bash', '-c', hold, **env), self.start('second', 'bash', '-c', hold, **env)
        for run in (first, second):
            self.addCleanup(run.kill)
        deadline = time.monotonic() + 30
        while len(list((self.tmp / 'heavy').glob('lock*'))) < 2 and time.monotonic() < deadline:   # both hold
            time.sleep(0.05)
        third = self.start('third', 'echo', 'ran', **env)
        time.sleep(1.2)
        self.assertIsNone(third.poll(), 'the third waited for a slot')
        open(go, 'w').write('go')
        _, err = third.communicate(timeout=30)
        first.communicate(timeout=30); second.communicate(timeout=30)
        self.assertIn('third waits', err)


if __name__ == '__main__':
    unittest.main()
