"""The fixed place table (src/regions.py): "Switzerland" finds Swiss towns and nothing else (#278, 5 Oct 2026)."""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import regions  # noqa: E402


class SwitzerlandTests(unittest.TestCase):
    def pattern(self, name='Switzerland'):
        return re.compile('|'.join(regions.expand([name])), re.I)

    def test_towns_that_sit_inside_other_words_do_not_let_a_foreign_job_in(self):
        pattern = self.pattern()
        for place in ('Bielefeld, Germany', 'Baden-Württemberg, Germany', 'Baden-Baden', 'Freiburg im Breisgau', 'Freiburg i. Br., Germany', 'Carbonia, Italy',
                      'Custer, SD', 'Canyon Lake, TX', 'Thunder Bay', 'Mission Viejo', 'Stansted, UK', 'Berlin, Germany', 'Fusion Hub', 'Klagenfurt, AT, 9020'):
            self.assertIsNone(pattern.search(place), place)

    def test_the_swiss_towns_are_still_found(self):
        pattern = self.pattern()
        for place in ('Biel/Bienne', 'Biel BE', 'Baden, Switzerland', 'Baden AG', 'Freiburg', 'Fribourg', 'Thun', 'Uster', 'Arbon', 'Wil SG', 'Nyon', 'Sion', 'Buchs SG',
                      'Emmen', 'Stans', 'Olten', 'Zürich', 'Lausanne', 'Genève', 'Manno', 'Bern'):
            self.assertIsNotNone(pattern.search(place), place)

    def test_the_regions_built_from_the_same_towns_follow(self):
        romandie, german = self.pattern('Romandie'), self.pattern('Deutschschweiz')
        self.assertIsNone(romandie.search('Freiburg im Breisgau'))
        self.assertIsNotNone(romandie.search('Biel/Bienne'))
        self.assertIsNone(romandie.search('Bielefeld'))
        self.assertIsNone(german.search('Baden-Württemberg, Germany'))
        self.assertIsNotNone(german.search('Baden AG'))


if __name__ == '__main__':
    unittest.main()
