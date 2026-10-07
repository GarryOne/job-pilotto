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
        if 'Countries:' in content:
            answer = {'visa': []}
        else:
            listed = content.split('The job locations:\n', 1)[1].split('\n')
            answer = {'locations': [{'n': int(line.split('.', 1)[0]), 'where': '', 'country': 'Switzerland', 'nearest': 'none', 'km': -1,
                                     'answer': 'best' if any(w in line for w in self.BEST) else 'inside' if any(w in line for w in self.INSIDE) else 'out'}
                                    for line in listed]}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))],
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
        places_calls = [call for call in client.calls if 'The job locations:' in call]
        self.assertEqual(len(places_calls), 2)
        self.assertNotIn('work_rights', places_calls[0], 'the place question never sees the work rights (7 Oct 2026: Swiss towns became "inside")')
        self.assertNotIn('Sion', places_calls[1].split('The job locations:')[1].replace('sion', ''), 'Sion was placed before')
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


class PlaceFallbackTests(unittest.TestCase):
    """Until Claude has placed a location, the place words decide: as written or without accents, and they never close a job Claude is about
    to place (7 Oct 2026: "Genève" was "outside your places" and Carouge jobs closed for a Geneva search)."""
    WORDS = ['geneva', 'geneve']

    def setUp(self):
        feeds.PLACED = {}

    def tearDown(self):
        feeds.PLACED = None

    def test_every_place_word_fallback_finds_the_accented_name(self):
        from src import digest, time_budget
        from src.paths import keyword_regex
        words = keyword_regex(self.WORDS)
        job, elsewhere = {'location': 'Genève, Switzerland'}, {'location': 'Basel'}
        with mock.patch.object(digest, 'HOME', words), mock.patch.object(digest, 'BEST_PLACES', words), mock.patch.object(feeds, 'PLACE', words), \
                mock.patch('src.paths.load_search_config', return_value={'locations': {'top_tier': self.WORDS}}):
            checks = {'feeds.wanted_location': feeds.wanted_location(job), 'digest.in_places': digest.in_places(job),
                      'digest.location_points': digest.location_points(job) == 5,
                      'time_budget.best_first': time_budget.best_first([elsewhere, job])[0] is job}
        self.assertEqual([name for name, ok in checks.items() if not ok], [])

    def test_the_open_jobs_are_placed_before_the_cleanup(self):
        import sqlite3
        from src import daily
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE jobs (location TEXT, title TEXT, state TEXT)')
        db.executemany('INSERT INTO jobs VALUES (?, ?, ?)', [('Carouge', 'Vendeur', 'open'), ('Basel', 'Vendeur', 'closed'), ('', 'Vendeur', 'open')])
        sent = []
        with mock.patch.object(feeds, 'triage_places', sent.extend):
            feeds.place_open_jobs(db)
        self.assertEqual(sent, [{'location': 'Carouge', 'title': 'Vendeur'}], 'a job board job is placed like a feed job')
        source = pathlib.Path(daily.__file__).read_text()
        self.assertLess(source.index('feed_places.place_open_jobs(db)'), source.index('store.close_elsewhere('), 'placed, then cleaned up')

    def test_a_refresh_asks_about_your_places_first_then_the_most_shared(self):
        jobs = [{'location': where, 'title': 'Vendeur'} for where in
                ['Warsaw', 'Dallas, TX', 'Carouge', 'Carouge', 'Genève, Switzerland', 'Meyrin', 'Carouge']]
        asked = []
        with mock.patch.object(feeds, 'PLACE', feeds.keyword_regex(self.WORDS)), mock.patch.object(feeds, 'wanted_title', lambda title: True), \
                mock.patch('src.ai.engine.ready', return_value=True), \
                mock.patch.object(place_triage, 'decide', lambda locations, search: asked.extend(locations) or {}):
            feeds.triage_places(jobs)
        self.assertEqual(asked[:2], ['genève, switzerland', 'carouge'])
        self.assertEqual(set(asked[2:]), {'warsaw', 'dallas, tx', 'meyrin'})
