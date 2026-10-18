"""Scoring keeps its own minutes of a timed search, whatever the steps before it spent (src/time_budget.py score_own)."""
import unittest

from src import time_budget


class ScoreOwnTest(unittest.TestCase):
    def tearDown(self):
        time_budget.start(0)

    def test_scoring_gets_its_own_budget_after_the_other_steps_spent_the_clock(self):
        # 18 Oct 2026, Cluj: 165 of 180 s gone before scoring; it scored the 3-job floor instead of ~55
        for spent in (0, 60, 165, 179, 400):   # every way the steps before can use the budget, even past the deadline
            with self.subTest(spent=spent):
                time_budget.start(180, now=0)
                time_budget.score_own(now=spent)
                taken = time_budget.batch('score', 1000, now=spent, say=False)
                self.assertGreaterEqual(taken, 50, f'scoring took {taken} of 1000 jobs after {spent} s')

    def test_no_budget_stays_no_budget_and_a_longer_deadline_is_kept(self):
        time_budget.start(0)
        time_budget.score_own(now=5)
        self.assertIsNone(time_budget.DEADLINE)
        time_budget.start(1000, now=0)
        time_budget.score_own(now=10)
        self.assertEqual(time_budget.DEADLINE, 1000)


if __name__ == '__main__':
    unittest.main()
