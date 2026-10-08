"""The starting sources are central (6 Oct 2026): the public starter feeds and seed lists are empty, the central scout (job-pilotto-internal)
publishes them in the employer index with their places and role mix, and an install ignores the copies of the old shipped lists it still has."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
import sys  # noqa: E402
sys.path.insert(0, str(ROOT))
from src import scout, scout_candidates, scout_core  # noqa: E402
from src.legacy_lists import SHIPPED_FEEDS, SHIPPED_SEED_NAMES  # noqa: E402


class PublicListsTest(unittest.TestCase):
    def test_the_public_files_are_empty_but_keep_their_shape(self):
        seeds = json.loads((ROOT / 'config' / 'scout_seeds.json').read_text())
        self.assertEqual((seeds['tier1'], seeds['tier1_known'], seeds['manual_watch'], seeds['regional']), ([], [], [], {}))
        self.assertEqual(list(scout.seed_candidates(seeds)), [], 'an empty list harvests nothing and does not fail')
        self.assertEqual(json.loads((ROOT / 'config' / 'sources.json').read_text()), [])

    def test_an_install_ignores_the_old_shipped_lists_and_keeps_its_own(self):
        stripe = next(iter(SHIPPED_FEEDS))
        own = {'company': 'Boutique Photo SA', 'ats': 'recruitee', 'slug': 'boutiquephoto'}
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'sources.json').write_text(json.dumps([{'company': 'Old', 'ats': stripe[0], 'slug': stripe[1]}, own]))
            with mock.patch.object(scout_candidates, 'CONFIG', Path(tmp)), mock.patch.object(scout_core, 'CENTRAL', False):
                self.assertEqual(scout.starter_list(), [own])
            with mock.patch.object(scout_candidates, 'CONFIG', Path(tmp)), mock.patch.object(scout_core, 'CENTRAL', True):
                self.assertEqual(len(scout.starter_list()), 2, 'the central scout keeps its full list')
        old_name = next(iter(SHIPPED_SEED_NAMES))
        seeds = {'excluded': [], 'tier1_known': [], 'tier1': [old_name, 'Manor'], 'manual_watch': [], 'regional': {}}
        with mock.patch.object(scout_core, 'CENTRAL', False):
            self.assertEqual([c['name'] for c in scout.seed_candidates(seeds)], ['Manor'])
        with mock.patch.object(scout_core, 'CENTRAL', True):
            self.assertEqual(len(list(scout.seed_candidates(seeds))), 2)


if __name__ == '__main__':
    unittest.main()
