import sqlite3
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout, scout_core, scout_role_search as rs

SEARCH = {'role_keywords': [r'\bsre\b', 'platform engineer'], 'locations': {'top_tier': ['London'], 'country_wide': [], 'abroad': []}}
URLS = ['https://jobs.ashbyhq.com/wynd-labs/a148c710', 'https://jobs.ashbyhq.com/zauber', 'https://jobs.ashbyhq.com/zauber/other-job',
        'https://job-boards.greenhouse.io/embed/job_board?for=kalepa', 'https://example.com/careers', 'https://jobs.lever.co/jobs',
        'https://jobs.ashbyhq.com/g2i/9a0bba35?env_prod=true']


def memory_db():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    scout_core.ensure_tables(db)
    return db


class RoleSearchTest(unittest.TestCase):
    def test_candidates_are_boards_once_with_their_system_and_slug(self):
        found = rs.candidates(URLS, 'Role search 2026-10-18')
        self.assertEqual([(c['ats'], c['slug']) for c in found],
                         [('ashby', 'wynd-labs'), ('ashby', 'zauber'), ('greenhouse', 'kalepa'), ('ashby', 'g2i')])
        self.assertEqual(found[0]['name'], 'Wynd Labs')
        self.assertTrue(all(c['origin'] == 'Role search 2026-10-18' and c['priority'] == rs.PRIORITY for c in found))

    def test_queries_cover_every_role_on_every_host_and_wrap_around(self):
        roles = ['sre', 'platform engineer']
        everything = rs.pairs(roles)
        self.assertEqual(len(everything), len(roles) * len(rs.BOARD_HOSTS))
        self.assertEqual(len(set(everything)), len(everything))
        seen = set()
        for step in range(len(everything)):
            seen.update(rs.take(everything, step * 3, 3))
        self.assertEqual(seen, set(everything))

    def test_run_searches_a_slice_each_time_and_remembers_where_it_stopped(self):
        db, asked = memory_db(), []
        def searcher(role, host_key, place):
            asked.append((role, host_key, place))
            return URLS
        first = rs.run(db, SEARCH, searcher=searcher)
        second = rs.run(db, SEARCH, searcher=searcher)
        self.assertEqual(len(asked), 2 * rs.QUERIES_PER_RUN)
        self.assertEqual(len(set(asked)), len(asked), 'the second run must not repeat the first run\'s searches')
        self.assertEqual(first['queries'], rs.QUERIES_PER_RUN)
        self.assertEqual(len(first['candidates']), 4)
        self.assertEqual(second['queries'], rs.QUERIES_PER_RUN)

    def test_a_failing_search_is_skipped_and_the_rest_answer(self):
        calls = []
        def searcher(role, host_key, place):
            calls.append(host_key)
            if len(calls) == 1:
                raise RuntimeError('rate limited')
            return URLS[:1]
        found = rs.run(memory_db(), SEARCH, searcher=searcher)
        self.assertEqual(len(calls), rs.QUERIES_PER_RUN)
        self.assertEqual(len(found['candidates']), 1)

    def test_no_search_available_means_no_queries(self):
        found = rs.run(memory_db(), SEARCH, searcher=None, provider=lambda: None)
        self.assertEqual((found['queries'], found['candidates']), (0, []))

    def test_roles_are_the_owners_not_a_fixed_list(self):
        self.assertEqual(rs.role_words(SEARCH), ['sre', 'platform engineer'])
        self.assertEqual(rs.role_words({'role_keywords': []}), [])

    def test_scout_run_adds_the_role_search_candidates_to_the_queue(self):
        db = memory_db()
        added = scout.harvest(db, {'excluded': []}, [lambda: rs.candidates(URLS, 'Role search 2026-10-18')])
        self.assertEqual(added, 4)
        row = db.execute("SELECT ats, slug, status FROM scout_candidates WHERE slug = 'zauber'").fetchone()
        self.assertEqual((row['ats'], row['slug'], row['status']), ('ashby', 'zauber', 'pending'))

    def test_guarded_does_nothing_for_tests_with_their_own_sources(self):
        self.assertIsNone(rs.guarded(memory_db(), SEARCH, harvest_sources=[]))


if __name__ == '__main__':
    unittest.main()
