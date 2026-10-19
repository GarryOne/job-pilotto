"""The central scout's AI ideas aim at the central list's thinnest kind × country (src/scout_cells.py).
19 Oct 2026: they were asked for the example search's data-analyst roles and answered "scale-ups and SaaS or fintech engineering hubs";
Europe had 837 software employers against 5 hospitality and 4 logistics (owner: "a global job search, across europe")."""
import sqlite3
import unittest
from unittest import mock

from src import scout, scout_cells, scout_core
from src.ai import scout_ideas


def feed(kind, *countries):
    return {'kinds': {kind: 0.9}, 'countries': list(countries)}


class ThinCellTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')

    def test_counts_by_main_kind_and_european_country_only(self):
        self.assertEqual(scout_cells.count([feed('healthcare', 'de', 'us'), feed('healthcare', 'de'), {'countries': ['fr']}]),
                         {'healthcare|de': 2, 'unknown|fr': 1})

    def test_aims_at_the_thinnest_cell_then_the_next_never_software(self):
        full = [feed(kind, country) for kind in scout_cells.AIMED for country in ('ch', 'de') for _ in range(scout_cells.FLOOR)]
        scout_cells.keep(self.db, full + [feed('logistics', 'pl')] + [feed('software', 'hu')])
        first = scout_cells.next_cell(self.db)
        self.assertNotEqual(first[0], 'software')
        self.assertNotIn(first[1], ('ch', 'de'), 'cells at the floor are strong enough')
        self.assertNotEqual(first, ('logistics', 'pl'), 'a cell with one employer comes after the empty ones')
        self.assertNotEqual(scout_cells.next_cell(self.db), first, 'the next run aims elsewhere')

    def test_no_counts_yet_means_the_usual_search(self):
        own = {'role_keywords': ['data analyst']}
        self.assertEqual(scout_cells.aim(self.db, own), (own, ''))

    def test_the_cell_gets_the_general_prompt_with_its_work_and_country(self):
        scout_cells.keep(self.db, [])
        search, label = scout_cells.aim(self.db, {'role_keywords': ['data analyst']})
        self.assertEqual(label, scout_cells.AIMED[0])
        self.assertEqual(search['locations']['country_wide'], ['Switzerland'])
        nurse = scout_cells.search_for('healthcare', 'pl')
        self.assertEqual((nurse['role_keywords'][0], nurse['locations']['country_wide']), ('nursing', ['Poland']))
        self.assertIs(scout_ideas.ideas_system(nurse), scout_ideas.IDEAS_SYSTEM_GENERAL)
        self.assertEqual(self.db.execute("SELECT value FROM scout_meta WHERE key = 'ideas_cell'").fetchone()[0], f'{label}|ch',
                         'plain text: central_stats sends it to /admin/scouting as it is')

    def test_the_central_scout_asks_the_ideas_for_the_cell_and_tags_their_origin(self):
        scout_cells.keep(self.db, [])
        asked = []
        def run(db, search, label=''):
            asked.append((search['locations']['country_wide'], label))
            return {'candidates': [], 'companies': 0, 'directories': 0, 'note': ''}
        with mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.object(scout_ideas, 'run', run), \
                mock.patch('src.features.enabled', lambda name: True), mock.patch('src.ai.engine.ready', lambda: True), \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': ''}):
            scout.ai_ideas(self.db)
        self.assertEqual(asked, [(['Switzerland'], scout_cells.AIMED[0])])

    def test_the_origin_carries_the_kind(self):
        self.assertEqual(scout_ideas.origin_kind('AI idea healthcare 2026-10-19'), 'AI idea healthcare')


if __name__ == '__main__':
    unittest.main()
