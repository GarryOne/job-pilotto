"""Locations, one source (owner, 17 Oct 2026): what the crawl matches is DERIVED from the person's places, with an optional explicit override.
Preferred + acceptable are always searched; places abroad only while relocation is not "no" (no key = as before); a search-only list replaces them
and says so; the words as written (matching=False views) stay untouched."""
import unittest
from unittest import mock

from src import paths


def view(**locations):
    config = {'role_keywords': ['sre'], 'locations': {'top_tier': ['zurich'], 'country_wide': ['switzerland'], 'abroad': ['berlin'], **locations}}
    with mock.patch('src.places.load', return_value={}):
        return paths.with_matching_words(config)['locations']


class LocationsSearchTests(unittest.TestCase):
    def test_no_relocation_key_keeps_every_list_as_before(self):
        places = view()
        self.assertEqual(places['top_tier'], ['zurich'])
        self.assertTrue(places['country_wide'] and places['abroad'])

    def test_relocation_yes_or_unspecified_keeps_places_abroad(self):
        self.assertTrue(view(relocation=['yes'])['abroad'])
        self.assertTrue(view(relocation=['unspecified'])['abroad'])

    def test_relocation_no_drops_places_abroad_from_the_search_only(self):
        places = view(relocation=['no'])
        self.assertEqual(places['abroad'], [])
        self.assertTrue(places['top_tier'] and places['country_wide'])

    def test_a_search_only_list_replaces_the_derived_places_and_is_not_empty_by_accident(self):
        places = view(search_override=['netherlands', 'germany'])
        self.assertEqual(places['top_tier'], ['netherlands', 'germany'])
        self.assertEqual((places['country_wide'], places['abroad']), ([], []))
        self.assertEqual(view(search_override=[])['top_tier'], ['zurich'])   # an empty override means none: the derived places search

    def test_the_words_as_written_are_not_derived(self):
        config = {'locations': {'top_tier': ['zurich'], 'country_wide': [], 'abroad': ['berlin'], 'relocation': ['no'], 'search_override': ['x']}}
        with mock.patch('src.paths.CONFIG', mock.Mock(__truediv__=lambda s, n: mock.Mock(read_text=lambda: __import__('json').dumps(config)))):
            written = paths.load_search_config(matching=False)['locations']
        self.assertEqual((written['top_tier'], written['abroad']), (['zurich'], ['berlin']))


if __name__ == '__main__':
    unittest.main()
