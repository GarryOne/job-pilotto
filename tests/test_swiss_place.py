import unittest

from src.sources import boards


class SwissPlaceTest(unittest.TestCase):
    """The Swiss check reads place words; a Swiss name inside a longer word is not Swiss (6 Oct 2026: 'bern' matched São Bernardo, so a Brazilian user's
    search was read as Swiss and jobs.ch and SwissDevJobs were crawled for them)."""

    def test_swiss_places_are_swiss(self):
        for place in ('Bern', 'Berne', 'Basel', 'Bâle', 'Zürich', 'Genève', 'Lugano', 'Switzerland', 'Zug'):
            self.assertTrue(boards.SWISS_PLACE.search(place), place)

    def test_a_swiss_name_inside_another_word_is_not(self):
        for place in ('São Bernardo do Campo', 'Bernal', 'Dubale', 'Bernardino'):
            self.assertFalse(boards.SWISS_PLACE.search(place), place)

    def test_a_brazilian_search_is_not_swiss(self):
        search = {'locations': {'top_tier': ['são bernardo do campo', 'sao paulo'], 'country_wide': ['brazil'], 'abroad': ['portugal']}}
        self.assertFalse(boards.swiss_places(search))
        self.assertIsNone(boards.swiss_place_word(search))

    def test_a_swiss_search_names_its_word(self):
        self.assertEqual(boards.swiss_place_word({'locations': {'top_tier': ['Lugano']}}), 'Lugano')


if __name__ == '__main__':
    unittest.main()
