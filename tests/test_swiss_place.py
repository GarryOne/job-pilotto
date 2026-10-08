import unittest
from unittest import mock

from src.sources import boards

# What places.json holds once the AI worked the words out (src/places.py): each word's countries, in any language.
KNOWN = {'zürich': {'kind': 'city', 'countries': ['Switzerland']}, 'genève': {'kind': 'city', 'countries': ['Switzerland']},
         'são bernardo do campo': {'kind': 'city', 'countries': ['Brazil']}, 'sao paulo': {'kind': 'city', 'countries': ['Brazil']},
         'brazil': {'kind': 'country', 'countries': ['Brazil']}, 'portugal': {'kind': 'country', 'countries': ['Portugal']}}


class SwissPlaceTest(unittest.TestCase):
    """A search is Swiss when the AI said one of its place words is in Switzerland, or a Swiss region word names it (6 Oct 2026: a regex
    read 'bern' in São Bernardo, so a Brazilian user's search was read as Swiss; 8 Oct 2026: no regex of place names at all)."""

    def setUp(self):
        patch = mock.patch('src.places.load', return_value=KNOWN)
        patch.start()
        self.addCleanup(patch.stop)

    def test_swiss_places_are_swiss(self):
        for word in ('Zürich', 'Genève', 'Romandie'):
            self.assertEqual(boards.swiss_place_word({'locations': {'top_tier': [word]}}), word)

    def test_a_brazilian_search_is_not_swiss(self):
        search = {'locations': {'top_tier': ['são bernardo do campo', 'sao paulo'], 'country_wide': ['brazil'], 'abroad': ['portugal']}}
        self.assertFalse(boards.swiss_places(search))

    def test_a_swiss_city_is_swiss_before_the_ai_worked_it_out(self):
        """The first market works offline: Switzerland's fixed table (src/regions.py) knows its towns, so a Zurich or Basel search crawls
        jobs.ch on its first run, with or without AI (8 Oct 2026, the owner: "will the app work the same for a Swiss candidate?")."""
        with mock.patch('src.places.load', return_value={}):
            for word in ('Basel', 'Zürich', 'Lugano', 'Zug'):
                self.assertEqual(boards.swiss_place_word({'locations': {'top_tier': [word]}}), word)
            self.assertIsNone(boards.swiss_place_word({'locations': {'top_tier': ['São Bernardo do Campo']}}))


if __name__ == '__main__':
    unittest.main()
