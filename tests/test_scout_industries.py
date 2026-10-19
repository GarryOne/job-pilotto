"""The scout finds employers of a kind of role through Wikidata's own classes for them (src/scout_candidates.py INDUSTRIES).
19 Oct 2026: Wikidata lists 906 German hospitals with a website, the scout's "business" query reached 110; the central list had 4 healthcare
employers in Germany, 4 logistics and 5 hospitality in all of Europe (owner: "a global job search, across europe")."""
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import role_kinds, scout_candidates, scout_core


def row(name, site):
    return {'label': {'value': name}, 'site': {'value': site}}


class IndustryListTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.asked = []

    def get(self, url, **_):
        self.asked.append(url)
        return {'results': {'bindings': [row(f'Org {len(self.asked)}', f'https://org{len(self.asked)}.example')]}}

    def run_once(self, kinds, countries, per_run=1):
        return list(scout_candidates.wikidata_industry_candidates(self.db, kinds, countries, get=self.get, cache=Path(self.tmp.name) / 'w.json',
                                                                  per_run=per_run))

    def test_a_nurses_search_asks_for_hospitals_then_care_homes_in_its_country(self):
        first = self.run_once(['healthcare'], ['Germany'])
        self.assertEqual([c['origin'] for c in first], ['Wikidata healthcare: Germany'])
        self.assertIn('wd%3AQ16917', self.asked[0])   # hospital
        self.run_once(['healthcare'], ['Germany'])
        self.assertIn('wd%3AQ837142', self.asked[1])  # then nursing home: one query a run, in turn
        again = self.run_once(['healthcare'], ['Germany'])
        self.assertEqual((len(self.asked), [c['name'] for c in again]), (2, ['Org 1']), 'the turn wraps around to the hospitals, kept a week')

    def test_a_list_is_kept_a_week(self):
        self.run_once(['education'], ['Spain'])
        self.run_once(['education'], ['Spain'])
        self.assertEqual(len(self.asked), 1, 'the second run reads the kept list: Wikidata is asked once')

    def test_kinds_without_a_class_or_unknown_ask_nothing(self):
        self.assertEqual(self.run_once(['software', 'other'], ['Germany']), [])
        self.assertEqual(self.run_once([], ['Germany']), [])
        self.assertEqual(self.asked, [])

    def test_the_central_scout_asks_every_european_country_by_its_code(self):
        with mock.patch.object(scout_core, 'CENTRAL', True):
            countries = scout_candidates.industry_countries(['Switzerland'])
            self.assertEqual(set(scout_candidates.search_kinds()), set(scout_candidates.INDUSTRIES))
        self.assertIn('DE', countries)
        self.assertIn('HU', countries)
        self.run_once(['logistics'], ['DE'])
        self.assertRegex(self.asked[0], re.escape('wdt%3AP297%20%22DE%22'))

    def test_every_industry_is_a_kind_of_role(self):
        self.assertEqual(set(scout_candidates.INDUSTRIES) - set(role_kinds.KINDS), set())
        thin = {'healthcare', 'hospitality', 'logistics', 'education', 'trades'}   # the thin kinds of 19 Oct 2026
        self.assertEqual(thin - set(scout_candidates.INDUSTRIES), set())


if __name__ == '__main__':
    unittest.main()
