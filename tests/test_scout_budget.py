"""The scout's minutes count from its start, not from its first employer check (src/scout.py run).
19 Oct 2026, e1's live searches: a driver's scout given 180 s ran 638 s: the lists (a Wikidata timeout, 143 s), the AI's ideas (19 s) and the
role searches (103 s) ran before the clock started."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import scout, scout_core
from src import store as job_store
from tests.test_budget_tape import contextlib_quiet
from tests.test_scout import SEEDS


class WholeRunBudgetTest(unittest.TestCase):
    def run_scout(self, ideas_cost, search_cost, budget=20):
        """(steps that ran, employers checked) for a run whose idea and role-search steps take this many seconds of the clock."""
        t, ran = [0.0], []

        def ideas(db, harvest_sources=None):
            ran.append('ideas')
            t[0] += ideas_cost
            return None

        def search(db, search, harvest_sources=None):
            ran.append('role search')
            t[0] += search_cost
            return None

        def probe(system, slug):
            t[0] += 1
            return []
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, contextlib_quiet(), \
                mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.object(scout.time, 'monotonic', lambda: t[0]), \
                mock.patch.object(scout, 'ai_ideas', ideas), mock.patch.object(scout.scout_role_search, 'guarded', search):
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=f'Co{i}', origin='AI idea', priority=99 - i) for i in range(20)]])
            _, results = scout.run(db, batch=20, harvest_sources=[], probe=probe, workers=1, budget=budget)
        return ran, len(results)

    def test_the_steps_before_the_checks_use_the_same_minutes(self):
        ran, checked = self.run_scout(ideas_cost=8, search_cost=0)
        self.assertEqual(ran, ['ideas', 'role search'])
        self.assertLess(checked, self.run_scout(ideas_cost=0, search_cost=0)[1], 'the ideas took 8 of the 20 s: the checks get what is left')

    def test_new_names_wait_when_half_the_minutes_are_gone_so_the_checks_keep_theirs(self):
        ran, checked = self.run_scout(ideas_cost=11, search_cost=0)
        self.assertEqual(ran, ['ideas'], 'past half the budget, no role search starts')
        self.assertGreater(checked, 0, 'the checks still get the rest')

    def test_no_budget_runs_every_step(self):
        ran, checked = self.run_scout(ideas_cost=50, search_cost=50, budget=0)
        self.assertEqual(ran, ['ideas', 'role search'])
        self.assertGreater(checked, 0)


if __name__ == '__main__':
    unittest.main()
