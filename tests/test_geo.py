"""Places and job locations as country + coordinates (owner, 18 Oct 2026: a "Franken" search read jobs.ch because "Baden-Württemberg" matched the Swiss
town Baden). The model places each string once (fake model here), the code validates the answer, keeps it, and decides by country and distance."""
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src import geo

PLACES = {
    'franken': ('area', 'DE', 49.55, 10.9, 60), 'nürnberg': ('city', 'DE', 49.45, 11.08, 20), 'baden, ag': ('city', 'CH', 47.47, 8.31, 10),
    'baden-württemberg': ('area', 'DE', 48.6, 9.0, 100), 'zürich': ('city', 'CH', 47.37, 8.54, 25), 'zurigo': ('city', 'CH', 47.37, 8.54, 25),
    'wallisellen': ('city', 'CH', 47.41, 8.59, 5), 'altdorf': ('city', 'CH', 46.88, 8.64, 5), 'altdorf bei nürnberg': ('city', 'DE', 49.38, 11.36, 5),
    'germany': ('country', 'DE', None, None, None), 'remote - emea': ('remote', '', None, None, None), 'bogus': ('city', 'XX', 91.0, 8.0, 10)}


class Client:
    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        listed = kwargs['messages'][0]['content'].split('Strings:\n', 1)[1].split('\n')
        self.calls.append(listed)
        items = []
        for line in listed:
            n, text = line.split('. ', 1)
            kind, cc, lat, lon, r = PLACES.get(text, ('unknown', '', None, None, None))
            items.append({'n': int(n), 'kind': kind, 'cc': cc, 'lat': 0 if lat is None else lat, 'lon': 0 if lon is None else lon, 'r_km': 0 if r is None else r})
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'places': items}))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class GeoTests(unittest.TestCase):
    def setUp(self):
        self.patch = mock.patch.object(geo, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'geo.json')
        self.patch.start()

    def tearDown(self):
        self.patch.stop()

    def test_each_string_is_asked_once_and_spellings_share_nothing_by_name(self):
        client = Client()
        got = geo.resolve(['Zürich', 'Zurigo', 'Zürich'], client)
        self.assertEqual(got['zürich']['cc'], 'CH')
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0], ['1. zürich', '2. zurigo'])
        geo.resolve(['Zürich', 'Zurigo'], client)
        self.assertEqual(len(client.calls), 1)   # cached

    def test_invalid_answers_are_dropped_not_kept(self):
        got = geo.resolve(['bogus', 'never heard of it'], Client())
        self.assertNotIn('bogus', got)   # country code XX, latitude 91
        self.assertEqual(got.get('never heard of it', {}).get('kind'), 'unknown')

    def test_baden_in_two_countries_never_clash(self):
        """The Franken case: the region's added Baden-Württemberg and the Swiss town Baden are different places by country and distance."""
        client = Client()
        got = geo.resolve(['franken', 'baden, ag', 'baden-württemberg', 'nürnberg'], client)
        franken = got['franken']
        self.assertFalse(geo.within(franken, got['baden, ag']))
        self.assertTrue(geo.within(franken, got['nürnberg']))
        self.assertGreater(geo.km(got['franken'], got['baden, ag']), 200)

    def test_same_name_in_two_countries_differs_by_country(self):
        got = geo.resolve(['altdorf', 'altdorf bei nürnberg'], Client())
        self.assertFalse(geo.within(got['altdorf bei nürnberg'], got['altdorf']))

    def test_suburb_inside_the_radius_is_in(self):
        got = geo.resolve(['zürich', 'wallisellen'], Client())
        self.assertTrue(geo.within(got['zürich'], got['wallisellen']))

    def test_country_place_takes_any_town_of_the_country_only(self):
        got = geo.resolve(['germany', 'nürnberg', 'zürich'], Client())
        self.assertTrue(geo.within(got['germany'], got['nürnberg']))
        self.assertFalse(geo.within(got['germany'], got['zürich']))

    def test_remote_and_unknown_are_undecided(self):
        got = geo.resolve(['germany', 'remote - emea', 'never heard of it'], Client())
        self.assertIsNone(geo.within(got['germany'], got['remote - emea']))
        self.assertIsNone(geo.within(got['germany'], got['never heard of it']))

    def test_a_country_named_location_is_undecided_for_a_city_place(self):
        """"Switzerland" for someone who wants only Zürich names no town: the posting is read, as before."""
        got = geo.resolve(['zürich', 'germany'], Client())
        self.assertIsNone(geo.within(got['zürich'], {**got['germany'], 'cc': 'CH'}))

    def test_no_model_means_nothing_resolved(self):
        self.assertEqual(geo.resolve(['zürich'], None, ask=False), {})

    def test_distance_is_haversine(self):
        self.assertAlmostEqual(geo.km({'lat': 47.37, 'lon': 8.54}, {'lat': 46.2, 'lon': 6.14}), 224, delta=5)


class SwissTests(unittest.TestCase):
    def test_a_placed_word_is_swiss_by_its_country_code(self):
        from src import places
        with mock.patch.object(geo, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'geo.json'):
            geo.resolve(['altdorf bei nürnberg', 'baden, ag'], Client())
            self.assertFalse(places.in_switzerland('Altdorf bei Nürnberg', {}))
            self.assertTrue(places.in_switzerland('Baden, AG', {}))


class TriageTests(unittest.TestCase):
    """place_triage asks the model only for what the map cannot decide."""
    SEARCH = {'locations': {'top_tier': ['Franken'], 'country_wide': [], 'abroad': []}, 'remote_jobs': ['No']}

    def setUp(self):
        from src.ai import place_triage
        self.triage = place_triage
        self.patches = [mock.patch.object(geo, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'geo.json'),
                        mock.patch.object(place_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'p.json'),
                        mock.patch.object(place_triage, '_preferences', lambda: {})]
        for patch in self.patches:
            patch.start()
        geo.resolve(['franken', 'nürnberg', 'baden, ag', 'remote - emea'], Client())

    def tearDown(self):
        for patch in self.patches:
            patch.stop()

    def test_the_baden_case_is_out_without_asking_the_triage_model(self):
        class NoCalls:
            messages = SimpleNamespace(create=lambda **k: self.fail('the triage model was asked'))
        got = self.triage.decide(['Nürnberg', 'Baden, AG'], self.SEARCH, NoCalls())
        self.assertEqual(got['nürnberg'], 'best')
        self.assertEqual(got['baden, ag'], 'out')

    def test_remote_is_left_to_the_model(self):
        asked = []

        def create(**kwargs):
            asked.append(kwargs['messages'][0]['content'])
            return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'locations': [
                {'n': 1, 'where': '', 'country': '', 'nearest': 'none', 'km': -1, 'answer': 'out'}]}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))
        got = self.triage.decide(['Remote - EMEA'], self.SEARCH, SimpleNamespace(messages=SimpleNamespace(create=create)))
        self.assertEqual(len(asked), 1)
        self.assertEqual(got['remote - emea'], 'out')


if __name__ == '__main__':
    unittest.main()
