"""A search's AI steps stop at the time budget (owner, 7 Oct 2026: "never more than 2-3 minutes"); what is left waits for the next search,
your best places first, and the log says so."""
import contextlib
import io
import pathlib
import tempfile
import unittest
from unittest import mock

from src import time_budget as budget
from src.ai import title_triage
from tests.test_title_triage import SEARCH, Client


class BudgetTests(unittest.TestCase):
    def tearDown(self):
        budget.start(0)

    def test_each_step_keeps_time_for_the_ones_after_it(self):
        budget.start(180, now=0)
        self.assertFalse(budget.over('titles', now=100))
        self.assertTrue(budget.over('titles', now=110), 'titles stop 75 s early: reading and scoring still get time')
        self.assertFalse(budget.over('enrich', now=130))
        self.assertTrue(budget.over('enrich', now=145))
        self.assertFalse(budget.over('score', now=175))
        self.assertTrue(budget.over('score', now=180))

    def test_no_budget_never_stops(self):
        budget.start(0)
        self.assertFalse(budget.over('score', now=10 ** 9))

    def test_best_places_first_the_order_kept_otherwise(self):
        jobs = [{'id': 1, 'location': 'Sion'}, {'id': 2, 'location': 'Lausanne'}, {'id': 3, 'location': 'Zürich'}, {'id': 4, 'location': 'Genève'}]
        with mock.patch('src.paths.load_search_config', return_value={'locations': {'top_tier': ['gen[eè]v', 'lausanne']}}):
            self.assertEqual([j['id'] for j in budget.best_first(jobs)], [2, 4, 1, 3])


class TitlesStopTests(unittest.TestCase):
    def setUp(self):
        self.store = mock.patch.object(title_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 't.json')
        self.store.start()

    def tearDown(self):
        self.store.stop()
        budget.start(0)

    def test_time_up_asks_nothing_and_says_what_waits(self):
        budget.start(1, now=0)   # long spent
        client, out = Client(['magasin']), io.StringIO()
        with contextlib.redirect_stdout(out):
            got = title_triage.decide(['Collaborateur Magasin', 'Head of Growth'], SEARCH, client)
        self.assertEqual(client.calls, [])
        self.assertEqual(got, {}, 'undecided titles are asked about next search')
        self.assertIn('2 title(s) wait for the next one', out.getvalue())


if __name__ == '__main__':
    unittest.main()


class NoShadowTests(unittest.TestCase):
    def test_the_search_still_sees_the_ai_spending_budget(self):
        # 7 Oct 2026: a local "from . import budget" (this module, then named budget.py) hid src.ai.budget in daily.main, and every search
        # logged "budget check skipped": the monthly AI spend was not checked. Nothing in daily.py may bind the name again.
        import ast
        import pathlib
        tree = ast.parse(pathlib.Path('src/daily.py').read_text())
        local = [node.lineno for fn in ast.walk(tree) if isinstance(fn, ast.FunctionDef) for node in ast.walk(fn)
                 if isinstance(node, (ast.Import, ast.ImportFrom)) and any((alias.asname or alias.name) == 'budget' for alias in node.names)]
        self.assertEqual(local, [])
        # The same for every module daily.py imports at the top (7 Oct 2026: a local "added" hid src.ai.added): no assignment rebinds one.
        top = {(alias.asname or alias.name).split('.')[0] for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom)) for alias in node.names}
        main = next(fn for fn in tree.body if isinstance(fn, ast.FunctionDef) and fn.name == 'main')
        rebound = sorted({target.id for node in ast.walk(main) if isinstance(node, ast.Assign) for target in node.targets
                          if isinstance(target, ast.Name) and target.id in top})
        self.assertEqual(rebound, [], f'these names are modules daily.py imports: {rebound}')


class SizedBatchTests(unittest.TestCase):
    """Owner, 7 Oct 2026: "not a hard cut, a batch that is reasonably small": each step takes what it can finish, from its own pace."""
    def tearDown(self):
        budget.start(0)

    def test_no_budget_takes_everything_and_measures_nothing(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', pathlib.Path(tmp)):
            budget.start(0)
            self.assertEqual(budget.batch('score', 60), 60)
            budget.record('score', 30, 10)
            self.assertFalse((pathlib.Path(tmp) / 'step_pace.json').exists(), 'a test or a one-off command never sets the pace')

    def test_each_step_takes_its_share_at_its_own_measured_pace(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', pathlib.Path(tmp)), contextlib.redirect_stdout(io.StringIO()) as out:
            budget.start(180, now=0)
            self.assertEqual(budget.batch('score', 60, now=120), 20, '60 s left at 3 s a job')
            budget.record('score', 60, 30)   # this Mac scores at 2 s a job: the pace moves halfway there
            self.assertEqual(budget.batch('score', 60, now=120), 24, '60 s left at 2.5 s a job')
            self.assertEqual(budget.batch('titles', 300, now=60), 13, '20% of 120 s at 1.8 s a title')
            self.assertEqual(budget.batch('enrich', 5, now=0), 5, 'a small batch is taken whole, nothing said')
        self.assertIn('This refresh scores 20 of 60 jobs', out.getvalue())
        self.assertIn('40 wait for the next refresh, best places first', out.getvalue())


class PlaceCallsTests(unittest.TestCase):
    """Placing locations is paced per round of calls, not per location: Haiku answers 60 a call, two calls at once (7 Oct 2026: a refresh
    placed 32 of 1,500 locations, at 0.5 s a location at least)."""
    def tearDown(self):
        budget.start(0)

    def test_a_refresh_places_whole_rounds_of_calls(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', pathlib.Path(tmp)), contextlib.redirect_stdout(io.StringIO()) as out:
            budget.start(180, now=0)
            self.assertEqual(budget.in_calls('place_rounds', 1500, 60, 2, now=0), 240, '15% of 180 s at 10 s a round: 2 rounds of 2 calls of 60')
            budget.record('place_rounds', 6, 1)   # this Mac: a round in 6 s, the pace moves halfway there
            self.assertEqual(budget.in_calls('place_rounds', 1500, 60, 2, now=0), 360, '27 s at 8 s a round: 3 rounds')
            self.assertEqual(budget.in_calls('place_rounds', 50, 60, 2, now=0), 50, 'fewer than a round: all of them, nothing said')
        self.assertIn('This refresh places 240 of 1500 job locations', out.getvalue())
        budget.start(0)
        self.assertEqual(budget.in_calls('place_rounds', 1500, 60, 2), 1500, 'no budget: all of them')
