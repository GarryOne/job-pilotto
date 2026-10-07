"""Owner, 7 Oct 2026: "use AI to interpret locations; nothing hard-coded". Each new location is shown to Haiku with the places as the user wrote
them, the answer is kept per version of the places, and the place filter follows it ("Wallisellen" is near Zürich, not in Valais)."""
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from src.ai import place_triage
from src.sources import feeds

SEARCH = {'locations': {'top_tier': ['geneva', 'lausanne'], 'country_wide': ['Romandie'], 'abroad': []}, 'remote_jobs': ['No']}


class Client:
    """Answers like a model that knows Swiss geography for these few places."""
    BEST, INSIDE = ('lausanne', 'genève'), ('sion', 'brig')

    def __init__(self):
        self.calls = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        content = kwargs['messages'][0]['content']
        self.calls.append(content)
        listed = content.split('The job locations:\n', 1)[1].split('\n')
        pick = lambda words: [int(line.split('.', 1)[0]) for line in listed if any(w in line for w in words)]
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'best': pick(self.BEST), 'inside': pick(self.INSIDE)}))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1))


class PlaceTriageTests(unittest.TestCase):
    def setUp(self):
        self.store = mock.patch.object(place_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 'p.json')
        self.store.start()
        feeds.PLACED = None

    def tearDown(self):
        self.store.stop()
        feeds.PLACED = None

    def test_each_location_is_asked_once_with_the_places_in_words(self):
        client = Client()
        got = place_triage.decide(['Lausanne, Switzerland', 'Wallisellen, Switzerland', 'Sion', 'Klagenfurt, AT, 9020'], SEARCH, client)
        self.assertEqual(got, {'lausanne, switzerland': 'best', 'wallisellen, switzerland': 'out', 'sion': 'in', 'klagenfurt, at, 9020': 'out'})
        self.assertIn('"best_places": ["geneva", "lausanne"]', client.calls[0], 'the places as the user wrote them, not patterns')
        self.assertIn('"remote_jobs": "no"', client.calls[0])
        place_triage.decide(['Sion', 'Brig, Wallis, CH'], SEARCH, client)
        self.assertEqual(len(client.calls), 2)
        self.assertNotIn('Sion', client.calls[1].split('The job locations:')[1].replace('sion', ''), 'Sion was placed before')
        self.assertEqual(place_triage.known({**SEARCH, 'remote_jobs': ['Yes']}), {}, 'other places: asked afresh')

    def test_the_filter_follows_claude_and_falls_back_to_the_words(self):
        with mock.patch.object(feeds, 'PLACED', {'wallisellen, switzerland': 'out', 'lausanne': 'best'}):
            self.assertFalse(feeds.wanted_location({'location': 'Wallisellen, Switzerland'}))
            self.assertTrue(feeds.wanted_location({'location': 'Lausanne'}))
            self.assertEqual(feeds.place_of({'location': 'Somewhere new'}), None, 'not placed yet: the place words decide')


if __name__ == '__main__':
    unittest.main()


class DigestPlacesTests(unittest.TestCase):
    def tearDown(self):
        feeds.PLACED = None

    def test_the_digest_follows_claude_for_places_and_visas(self):
        from src import digest
        with mock.patch.object(feeds, 'PLACED', {'genève, switzerland': 'best', 'lyon, france': 'in:visa', 'basel': 'out'}):
            self.assertTrue(digest.in_places({'location': 'Genève, Switzerland'}), '"Genève" for a search that says "geneva"')
            self.assertEqual(digest.location_points({'location': 'Genève, Switzerland'}), 5)
            self.assertFalse(digest.needs_sponsorship({'location': 'Genève, Switzerland'}))
            self.assertTrue(digest.needs_sponsorship({'location': 'Lyon, France'}))
            self.assertFalse(digest.in_places({'location': 'Basel'}))

    def test_no_places_abroad_means_no_visa_warning_from_the_words(self):
        from src import digest
        with mock.patch.object(feeds, 'PLACED', {}), mock.patch.dict(digest._SEARCH['locations'], {'abroad': []}):
            self.assertFalse(digest.needs_sponsorship({'location': 'Somewhere not placed yet'}))
