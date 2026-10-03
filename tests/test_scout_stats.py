"""The central scout's own numbers (src/scout.py central_stats, market_coverage) sent with the index. No network."""
import json
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout  # noqa: E402


class StatsTests(unittest.TestCase):
    def test_market_coverage_counts_our_swiss_titles_against_jobsch_totals(self):
        pages = {'devops': '<h1>305 jobs</h1>', 'kubernetes': "<span>1'204 jobs</span>"}
        get = lambda url: next((page for term, page in pages.items() if f'term={term}' in url), '<p>nothing</p>')
        got = scout.market_coverage(['Senior DevOps Engineer', 'DevOps Lead', 'Kubernetes Admin', 'Chef'], get, ('devops', 'kubernetes', 'backend'), pause=0)
        self.assertEqual(got, [{'term': 'devops', 'ours': 2, 'jobsch': 305}, {'term': 'kubernetes', 'ours': 1, 'jobsch': 1204},
                               {'term': 'backend', 'ours': 0, 'jobsch': None}])

    def test_central_stats_hold_counts_and_the_scouts_own_source_names(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        scout.harvest(db, {'excluded': []}, [lambda: [dict(name='Acme', origin='Common Crawl CC-MAIN-2026-39', priority=70)]])
        db.execute("UPDATE scout_candidates SET status = 'found'")
        feeds_out = [{'ats': 'lever', 'jobs': 12, 'relevant': 3, 'regions': ['europe']}, {'ats': 'careers', 'jobs': 2, 'relevant': 1, 'regions': ['europe', 'remote']}]
        stats = scout.central_stats(db, feeds_out, [{'term': 'devops', 'ours': 2, 'jobsch': 305}])
        self.assertEqual((stats['feeds'], stats['jobs'], stats['relevant']), (2, 14, 4))
        self.assertEqual(stats['by_region'], {'europe': 2, 'remote': 1})
        self.assertEqual(stats['queue'], {'found': 1})
        self.assertEqual(stats['sources'], [{'origin': 'Common Crawl', 'probed': 1, 'found': 1}])
        self.assertEqual((stats['recipes'], stats['page_reads']), (0, 0), 'tables this scout never made count as 0')

    def test_the_numbers_travel_with_the_index(self):
        sent = []
        scout.publish_index([{'company': 'A', 'ats': 'lever', 'slug': 'a'}], 'https://x.test/api/index', 'k',
                            send=lambda request: sent.append(json.loads(request.data)) or 200, stats={'feeds': 1})
        self.assertEqual(sent[0]['stats'], {'feeds': 1})


if __name__ == '__main__':
    unittest.main()
