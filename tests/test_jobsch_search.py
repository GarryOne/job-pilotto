"""How the jobs check searches jobs.ch (src/sources/boards.py): in the user's own Swiss cities (and all of Switzerland when wanted), with each
board word on its own too (6 Oct 2026: page 1 of Switzerland-wide two-word searches kept 1 of 41 'vendeur' jobs in Geneva)."""
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import boards  # noqa: E402

SEARCH = {'board_discovery_keywords': ['photograph', 'vendeur', 'magasin'], 'jobs_board_search_queries': ['photographe', 'vendeur magasin', 'responsable de magasin'],
          'locations': {'top_tier': ['geneva', 'switzerland'], 'country_wide': [], 'abroad': []}}


class JobsChSearchTests(unittest.TestCase):
    def test_places_are_every_place_of_theirs_as_written_and_the_whole_country_when_wanted(self):
        """7 Oct 2026: a list of ten known cities meant Nyon, Morges and Gland were never searched; jobs.ch takes "geneva" as written."""
        self.assertEqual(boards.jobsch_places(SEARCH), ['geneva', None])
        self.assertEqual(boards.jobsch_places({'locations': {'top_tier': ['geneva', 'nyon', 'morges', 'gland']}}), ['geneva', 'nyon', 'morges', 'gland'])
        self.assertEqual(boards.jobsch_places({'locations': {'top_tier': ['zurich', 'z[uü]rich']}}), ['zurich'], 'one search per place')
        self.assertEqual(boards.jobsch_places({'locations': {'top_tier': ['switzerland']}}), [None])
        self.assertEqual(boards.jobsch_places({'locations': {}}), [None])

    def test_each_board_word_is_also_searched_on_its_own(self):
        self.assertEqual(boards.jobsch_terms(SEARCH), ['photographe', 'vendeur magasin', 'vendeur', 'magasin', 'responsable de magasin'])

    def test_searches_for_all_roles_are_worked_out_once_and_added(self):
        import json, tempfile
        from types import SimpleNamespace
        from unittest import mock
        asked = []

        class Client:
            messages = SimpleNamespace(create=lambda **kw: asked.append(kw) or SimpleNamespace(
                content=[SimpleNamespace(type='text', text=json.dumps({'queries': ['vendeur', 'caissier', 'magasinier']}))],
                usage=SimpleNamespace(input_tokens=1, output_tokens=1)))
        search = {**SEARCH, 'role_keywords': ['vendeur', 'caissier', 'magasinier', 'photographe', 'merchandiser']}
        with mock.patch('src.paths.DATA', Path(tempfile.mkdtemp())), mock.patch('src.ai.engine.ready', lambda *a: True):
            terms = boards.jobsch_terms(search, Client())
            boards.jobsch_terms(search, Client())
        self.assertEqual(terms, ['photographe', 'vendeur magasin', 'vendeur', 'magasin', 'responsable de magasin', 'caissier', 'magasinier'])
        self.assertEqual(len(asked), 1, 'worked out once per set of roles and places')
        self.assertIn('merchandiser', asked[0]['messages'][0]['content'], 'every role is told')

    def test_a_refresh_goes_on_where_the_last_one_stopped(self):
        import tempfile
        from unittest import mock
        pairs = [['vendeur', 'geneva'], ['vendeur', 'nyon'], ['caissier', 'geneva'], ['caissier', 'nyon']]
        with mock.patch('src.paths.DATA', Path(tempfile.mkdtemp())):
            first, done = boards.rotation(pairs)
            done(3)
            second, _ = boards.rotation(pairs)
        self.assertEqual(first, pairs)
        self.assertEqual(second[0], ['caissier', 'nyon'], 'the 4th pair first: the first refresh took 3')

if __name__ == '__main__':
    unittest.main()
