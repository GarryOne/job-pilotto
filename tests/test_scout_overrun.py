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
