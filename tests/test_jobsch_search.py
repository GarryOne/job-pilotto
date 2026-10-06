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
    def test_places_are_the_users_cities_and_the_whole_country_when_wanted(self):
        self.assertEqual(boards.jobsch_places(SEARCH), ['genève', None])
        self.assertEqual(boards.jobsch_places({'locations': {'top_tier': ['zurich', 'z[uü]rich']}}), ['zürich'])
        self.assertEqual(boards.jobsch_places({'locations': {'top_tier': ['switzerland']}}), [None])
        self.assertEqual(boards.jobsch_places({'locations': {}}), [None])

    def test_each_board_word_is_also_searched_on_its_own(self):
        self.assertEqual(boards.jobsch_terms(SEARCH), ['photographe', 'vendeur magasin', 'vendeur', 'magasin', 'responsable de magasin'])
        many = {**SEARCH, 'jobs_board_search_queries': [f'vendeur {i}' for i in range(20)]}
        self.assertEqual(len(boards.jobsch_terms(many)), boards.MAX_TERMS)


if __name__ == '__main__':
    unittest.main()
