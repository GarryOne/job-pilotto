"""The central scout's overrun watchdog writes thread stacks when the run outlives its budget, and stays silent when it ends in time."""
import io
import tempfile
import time
import unittest
from unittest import mock
from pathlib import Path

from src import scout_overrun


class OverrunTest(unittest.TestCase):
    def tearDown(self):
        scout_overrun.disarm()

    def test_no_budget_arms_nothing(self):
        self.assertFalse(scout_overrun.arm(0))

    def test_a_run_past_its_budget_leaves_its_stacks(self):
        with tempfile.TemporaryDirectory() as folder, open(Path(folder) / 'log.txt', 'w+') as out:
            self.assertTrue(scout_overrun.arm(0.1, grace_s=0.1, file=out))
            time.sleep(0.6)
            out.seek(0)
            self.assertIn('most recent call first', out.read())

    def test_a_run_that_ends_in_time_leaves_nothing(self):
        with tempfile.TemporaryDirectory() as folder, open(Path(folder) / 'log.txt', 'w+') as out:
            scout_overrun.arm(0.1, grace_s=0.3, file=out)
            scout_overrun.disarm()
            time.sleep(0.7)
            out.seek(0)
            self.assertEqual(out.read(), '')

    def test_a_central_run_with_a_thread_left_over_leaves_at_once_and_one_without_does_not(self):
        with mock.patch.object(scout_overrun.os, '_exit') as leave, mock.patch.object(scout_overrun.threading, 'active_count', return_value=3):
            scout_overrun.leave_if_stuck()
        leave.assert_called_once_with(0)
        with mock.patch.object(scout_overrun.os, '_exit') as leave, mock.patch.object(scout_overrun.threading, 'active_count', return_value=1):
            scout_overrun.leave_if_stuck()
        leave.assert_not_called()


if __name__ == '__main__':
    unittest.main()


class PhaseAndDeadlineTest(unittest.TestCase):
    def test_a_phase_says_how_long_it_took_even_when_it_raises(self):
        lines = []
        with self.assertRaises(ValueError):
            with scout_overrun.phase('checking feeds', out=lines.append):
                raise ValueError('x')
        self.assertRegex(lines[0], r'^Scout: checking feeds took \d+ s$')

    def test_the_publish_deadline_leaves_a_reserve_before_the_job_limit(self):
        self.assertEqual(scout_overrun.publish_deadline(100, job_s=600, reserve_s=60), 640)

    def test_a_big_slow_feed_list_is_cut_at_its_deadline_and_still_returns_what_answered(self):
        import tempfile
        from src import scout, store as job_store
        starter = [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}'} for i in range(400)]   # fictional: 400 feeds, 50 ms each
        def slow(system, slug):
            time.sleep(0.05)
            return [{'id': '1', 'title': 'Engineer', 'location': 'Zurich', 'url': 'u', 'date_posted': '2099-01-01', 'description': '', 'remote': False, 'salary': ''}]
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'j.sqlite') as db:
            db.executescript(scout.TABLES)
            began = time.monotonic()
            feeds, failed = scout.build_index(db, starter, slow, today='2026-09-30', workers=2, deadline=time.monotonic() + 0.5)
        self.assertLess(time.monotonic() - began, 3)   # un-bounded this takes 10 s
        self.assertEqual(failed, [])
        self.assertTrue(0 < len(feeds) < 400)
