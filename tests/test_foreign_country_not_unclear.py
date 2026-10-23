"""A job placed only in a country none of the user's places is in ("Canada" for a Moldova search) is outside their places, never "Place unclear"
(owner, 24 Oct 2026: "I searched for jobs only in Moldova, but I get remote jobs from all over the world"). "Unclear" is only a country that
could hold one of their places. Fictional settings; the map's answers are kept ones, no model is asked."""
import json
from collections import Counter
import pathlib
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import daily, desktop, digest, geo, source_yield
from src import store as job_store
from src.ai import place_triage
from src.sources import feeds

SEARCH = {'locations': {'top_tier': ['chisinau'], 'country_wide': ['moldova'], 'abroad': []}, 'remote_jobs': ['No'], 'remote_excluded_regions': []}
MAP = {'chisinau': {'kind': 'city', 'cc': 'MD', 'lat': 47.01, 'lon': 28.86, 'r': 30}, 'moldova': {'kind': 'country', 'cc': 'MD'},
       **{name: {'kind': 'country', 'cc': cc} for name, cc in (('canada', 'CA'), ('united states', 'US'), ('poland', 'PL'), ('united kingdom', 'GB'))}}
FOREIGN = ['Canada', 'United States', 'Poland', 'United Kingdom']


class Silent:
    def __init__(self):
        self.calls = 0
        self.messages = type('M', (), {'create': self.create})()

    def create(self, **kwargs):
        self.calls += 1
        raise AssertionError('the map already knows these countries: no model call')


class ForeignCountryNotUnclearTests(unittest.TestCase):
    def setUp(self):
        folder = pathlib.Path(tempfile.mkdtemp())
        (folder / 'geo.json').write_text(json.dumps(MAP))
        self.patches = [mock.patch.object(geo, 'STORE', folder / 'geo.json'), mock.patch.object(place_triage, 'STORE', folder / 'p.json'),
                        mock.patch.object(place_triage, 'READ_STORE', folder / 'r.json'), mock.patch.object(feeds, '_SEARCH', SEARCH)]
        for patch in self.patches:
            patch.start()
        feeds.PLACED, feeds.READ = {}, {}
        self.db = job_store.connect(folder / 'jobs.sqlite')
        locations = [*FOREIGN, 'Moldova']
        job_store.import_watch_report(self.db, {'jobs': [{'company': 'Co', 'id': str(n), 'title': 'Site Reliability Engineer', 'location': location,
                                                          'url': f'https://example.test/{n}', 'description': ''} for n, location in enumerate(locations)]})
        feeds.PLACED.update({place_triage.norm(loc): 'out:vague' for loc in locations})   # what the AI answered before this fix

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        feeds.PLACED = feeds.READ = None
        self.db.close()

    def jobs(self):
        return {j['location']: j for j in job_store.digest_jobs(self.db, limit=50, only_new=False)}

    def test_a_country_without_your_places_is_outside_not_unclear(self):
        for location in FOREIGN:
            with self.subTest(location):
                job = self.jobs()[location]
                self.assertEqual(feeds.place_of(job), 'out')
                self.assertFalse(digest.place_unclear(job))

    def test_your_own_country_stays_unclear(self):
        job = self.jobs()['Moldova']
        self.assertEqual(feeds.place_of(job), 'vague', 'positive control')
        self.assertTrue(digest.place_unclear(job))

    def test_every_consumer_agrees_after_the_refresh(self):
        # The refresh closes jobs outside your places (src/daily_search.py); then each place that lists jobs says the same.
        outside = Counter()
        self.assertEqual(job_store.close_elsewhere(self.db, feeds.keep_open, where=outside), len(FOREIGN), 'the foreign four are counted as outside')
        urls = {location: f'https://example.test/{n}' for n, location in enumerate([*FOREIGN, 'Moldova'])}
        listers = {
            'Jobs list': lambda: [r['url'] for r in desktop.jobs(self.db, notion_jobs=[], hide_unscored=True)['jobs']],
            'Telegram digest': lambda: [u for u in urls.values() if u in ''.join(digest.build_digest(self.db, seed=1)[0])],
            'waiting count': lambda: [] if desktop.jobs(self.db, notion_jobs=[], hide_unscored=True)['waiting'] == 0 else ['waiting'],
            'to score': lambda: [j['url'] for j in daily.to_score(self.db, set())],
        }
        for name, listed in listers.items():
            with self.subTest(name):
                shown = listed()
                for location in FOREIGN:
                    self.assertNotIn(urls[location], shown)
                if name == 'waiting count':
                    continue
                if name != 'to score':   # an unread vague job is never scored, but is listed
                    self.assertIn(urls['Moldova'], shown)

    def test_the_yield_count_leaves_them_out_of_in_your_places(self):
        job_store.close_elsewhere(self.db, feeds.keep_open)
        counted = sum(row['in_places'] for row in source_yield.measure(self.db, '2000-01-01T00:00:00'))
        self.assertEqual(counted, 1, 'only the Moldova job is "in your places"')

    def test_a_user_who_accepts_remote_keeps_them_as_before(self):
        accepting = {**SEARCH, 'remote_jobs': ['Yes']}
        with mock.patch.object(feeds, '_SEARCH', accepting):
            for location in FOREIGN:
                with self.subTest(location):
                    job = self.jobs()[location]
                    self.assertEqual(feeds.place_of(job), 'vague')
                    self.assertTrue(digest.place_unclear(job))

    def test_a_weak_vague_answer_is_cleared_without_asking(self):
        norms = [place_triage.norm(loc) for loc in [*FOREIGN, 'Moldova']]
        client = Silent()
        place_triage._keep(place_triage._key(SEARCH), {n: 'out' for n in norms[:-1]})   # Moldova itself would need the model's word
        decided = place_triage.vague(FOREIGN, SEARCH, client)
        for loc in FOREIGN:
            self.assertEqual(decided[place_triage.norm(loc)], 'out:clear')
        self.assertEqual(client.calls, 0)

    def test_an_unmapped_country_is_left_to_the_ai(self):
        self.assertFalse(geo.cannot_hold('Narnia', place_triage.places_words(SEARCH)), 'the map lacks it: not decided here')


if __name__ == '__main__':
    unittest.main()
