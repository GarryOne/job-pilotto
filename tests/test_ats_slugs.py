"""ats.slug_ok: a slug's shape per job system. One loop over every feed type, so a new type must say what its slugs look like."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats  # noqa: E402

GOOD = {'oracle': 'acme.us2.CX_1', 'workday': 'acme.wd3.Careers', 'successfactors': 'careers.acme.com', 'phenom': 'careers.acme.com',
        'eightfold': 'jobs.acme.com', 'umantis': 'recruitingapp-1234', 'greenhouse': 'acme', 'jobsch': '27602-manor-ag'}
BAD = {'oracle': 'acme.us2', 'workday': 'acme.Careers', 'successfactors': 'localhost', 'phenom': 'evil.com/x', 'eightfold': 'a b.com',
       'umantis': 'acme', 'greenhouse': 'a/b'}
NOT_SHARED = {'amazon', 'netflix', 'visit', 'careers'}


class SlugShapeTests(unittest.TestCase):
    def test_every_feed_type_says_which_slugs_it_accepts(self):
        for system in ats.FETCHERS:
            with self.subTest(system=system):
                if system in NOT_SHARED:
                    self.assertFalse(ats.slug_ok(system, 'acme'))
                    continue
                self.assertTrue(ats.slug_ok(system, GOOD.get(system, 'acme-co')))
                self.assertFalse(ats.slug_ok(system, BAD.get(system, 'a b/c')))

    def test_nothing_empty_and_no_unknown_system_passes_for_a_shared_board(self):
        for system in ats.FETCHERS:
            self.assertFalse(ats.slug_ok(system, ''))
            self.assertFalse(ats.slug_ok(system, None))


if __name__ == '__main__':
    unittest.main()
