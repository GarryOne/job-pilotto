"""The curated regional employer lists live in the private ops repo; the public seed file keeps only the starter set."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PublicSeedsTest(unittest.TestCase):
    def test_public_seed_file_has_no_regional_lists_but_still_works(self):
        seeds = json.loads((ROOT / 'config' / 'scout_seeds.json').read_text())
        self.assertEqual(seeds['regional'], {})          # the curated part is private (job-pilotto-ops)
        self.assertTrue(seeds['tier1'] and seeds['tier1_known'])   # a user's own scout still has a start
        from src import scout
        candidates = list(scout.seed_candidates(seeds))
        self.assertTrue(candidates)


if __name__ == '__main__':
    unittest.main()
