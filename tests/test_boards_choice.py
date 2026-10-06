"""Which job boards a search reads (src/sources/boards.py boards): developer boards only for IT roles (6 Oct 2026: a photographer's jobs check
crawled SwissDevJobs and TechTree)."""
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import boards  # noqa: E402

GENEVA = {'top_tier': ['geneva', 'switzerland'], 'country_wide': [], 'abroad': []}
BERLIN = {'top_tier': ['berlin'], 'country_wide': [], 'abroad': []}


class BoardChoiceTests(unittest.TestCase):
    def test_a_search_outside_it_reads_only_the_board_of_every_trade(self):
        photographer = {'role_keywords': ['photograph(e|er)?', 'vendeu(r|se)', 'magasinier'], 'locations': GENEVA}
        self.assertEqual(boards.boards(photographer), ['jobs.ch'])
        self.assertEqual(boards.boards({**photographer, 'locations': BERLIN}), [], 'outside Switzerland: no board at all')

    def test_an_it_search_keeps_every_board(self):
        sre = {'role_keywords': ['site reliability', r'\bsre\b'], 'locations': GENEVA}
        self.assertEqual(boards.boards(sre), ['jobs.ch', 'SwissDevJobs', 'TechTree'])
        self.assertEqual(boards.boards({**sre, 'locations': BERLIN}), ['TechTree'])

    def test_roles_not_known_yet_count_as_it(self):
        self.assertEqual(boards.boards({'role_keywords': [], 'locations': GENEVA}), ['jobs.ch', 'SwissDevJobs', 'TechTree'])


if __name__ == '__main__':
    unittest.main()
