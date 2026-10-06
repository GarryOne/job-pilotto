import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import store
from src.sources import google_jobs
from src.sources.feeds import database

CONFIG = {'queries': ['site reliability engineer', 'devops engineer'], 'country': 'ch',
          'locations': [{'location': 'Zurich,Zurich,Switzerland', 'language': 'de'}],
          'searches_per_run': 1, 'min_searches_left': 20}


def result(**overrides):
    return {'title': 'Site Reliability Engineer', 'company_name': 'Acme', 'location': 'Zürich, Switzerland',
            'via': 'LinkedIn', 'job_id': 'abc', 'description': 'Run <b>Kubernetes</b>.',
            'share_link': 'https://www.google.com/search?ibp=htl;jobs#abc',
            'apply_options': [{'title': 'LinkedIn', 'link': 'https://ch.linkedin.com/jobs/view/1'},
                              {'title': 'Acme', 'link': 'https://boards.greenhouse.io/acme/jobs/1'}],
            'detected_extensions': {'posted_at': '2 days ago'}, **overrides}


class FakeSerpApi:
    """Answers account.json and search.json; records the searches made."""
    def __init__(self, left=100, results=None, error=None):
        self.left, self.results, self.error, self.searches = left, results or [], error, []

    def __call__(self, request, timeout=None):
        url = urlsplit(request.full_url)
        params = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path.endswith('account.json'):
            body = {'total_searches_left': self.left}
        else:
            self.searches.append((params['q'], params['location'], params['hl'], params['gl']))
            body = {'error': self.error} if self.error else {'jobs_results': self.results}
        return io.BytesIO(json.dumps(body).encode())


class GoogleJobsTests(unittest.TestCase):
    def test_prefers_the_employer_link_over_aggregators(self):
        self.assertEqual(google_jobs.apply_url(result()), 'https://boards.greenhouse.io/acme/jobs/1')
        only_linkedin = result(apply_options=[{'link': 'https://ch.linkedin.com/jobs/view/1'}])
        self.assertEqual(google_jobs.apply_url(only_linkedin), 'https://ch.linkedin.com/jobs/view/1')
        self.assertTrue(google_jobs.apply_url(result(apply_options=[])).startswith('https://www.google.com/'))

    def test_keeps_matching_jobs_and_rotates_searches(self):
        api = FakeSerpApi(results=[result(), result(job_id='x', title='Sales Manager'),
                                   result(job_id='y', location='Toronto, Canada')])
        with tempfile.TemporaryDirectory() as tmp, database(Path(tmp) / 'db') as db:
            first = google_jobs.scan(db, 'key', CONFIG, opener=api, now='2026-09-27T10:00:00+00:00')
            self.assertEqual([j['title'] for j in first['jobs']], ['Site Reliability Engineer'])
            job = first['jobs'][0]
            self.assertEqual((job['status'], job['source'], job['url']),
                             ('new', 'Google Jobs', 'https://boards.greenhouse.io/acme/jobs/1'))
            self.assertEqual(job['description'], 'Run Kubernetes .')
            self.assertEqual(first['sources'][0]['matches'], 1)
            second = google_jobs.scan(db, 'key', CONFIG, opener=api, now='2026-09-27T14:00:00+00:00')
            self.assertEqual(second['jobs'][0]['status'], 'seen')
            # One paid search per run, the least recently searched pair first.
            # Each place in its own language: Google Jobs is empty for Zurich in English.
            self.assertEqual(api.searches, [('site reliability engineer', 'Zurich,Zurich,Switzerland', 'de', 'ch'),
                                            ('devops engineer', 'Zurich,Zurich,Switzerland', 'de', 'ch')])

    def test_plain_string_locations_search_in_english(self):
        self.assertEqual(google_jobs.places({'locations': ['New York,New York,United States',
                                                          {'location': 'Geneva,Geneva,Switzerland', 'language': 'fr'}]}),
                         {'New York,New York,United States': 'en', 'Geneva,Geneva,Switzerland': 'fr'})

    def test_stops_before_the_reserve(self):
        api = FakeSerpApi(left=20, results=[result()])
        with tempfile.TemporaryDirectory() as tmp, database(Path(tmp) / 'db') as db:
            report = google_jobs.scan(db, 'key', CONFIG, opener=api)
        self.assertEqual((report, api.searches), ({'jobs': [], 'sources': []}, []))

    def test_api_errors_are_reported_not_raised(self):
        api = FakeSerpApi(error='Invalid API key.')
        with tempfile.TemporaryDirectory() as tmp, database(Path(tmp) / 'db') as db:
            report = google_jobs.scan(db, 'key', CONFIG, opener=api)
        self.assertFalse(report['sources'][0]['ok'])
        self.assertIn('Invalid API key', report['sources'][0]['error'])
        empty = FakeSerpApi(error="Google hasn't returned any results for this query.")
        with tempfile.TemporaryDirectory() as tmp, database(Path(tmp) / 'db') as db:
            self.assertTrue(google_jobs.scan(db, 'key', CONFIG, opener=empty)['sources'][0]['ok'])

    def test_places_outside_the_users_search_are_left_out(self):
        """6 Oct 2026: a French CV with no address was drafted "France" / gl=fr for a search in Geneva."""
        geneva = {'locations': {'top_tier': ['geneva', 'switzerland'], 'country_wide': [], 'abroad': []}}
        drafted = {'queries': ['photographe'], 'country': 'fr', 'locations': [{'location': 'France', 'language': 'fr'}]}
        with contextlib.redirect_stdout(io.StringIO()):
            got = google_jobs.settings({**geneva, 'google_jobs': drafted})
        self.assertEqual((got['country'], got['locations']), ('ch', [{'location': 'Switzerland', 'language': 'fr'}]))
        right = {'queries': ['x'], 'country': 'ch', 'locations': [{'location': 'Geneva,Geneva,Switzerland', 'language': 'fr'},
                                                                  {'location': 'Paris,Paris,France', 'language': 'fr'}]}
        with contextlib.redirect_stdout(io.StringIO()):
            kept = google_jobs.settings({**geneva, 'google_jobs': right})
        self.assertEqual(kept['locations'], right['locations'][:1], 'a place in a chosen country stays, the other goes')
        unknown = {'locations': {'top_tier': ['atlantis'], 'country_wide': [], 'abroad': []}, 'google_jobs': drafted}
        self.assertEqual(google_jobs.settings(unknown)['locations'], drafted['locations'], 'places we cannot place: as drafted')
        self.assertEqual(google_jobs.settings(geneva)['locations'], [], 'no Google Jobs places, still none')

    def test_imported_under_the_google_jobs_source(self):
        api = FakeSerpApi(results=[result()])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'jobs.sqlite'
            with database(path) as feed_db:
                report = google_jobs.scan(feed_db, 'key', CONFIG, opener=api)
            with store.connect(path) as db:
                self.assertEqual(store.import_watch_report(db, report), ['new'])
                row = db.execute("""SELECT sources.name, sources.kind, jobs.notes FROM jobs
                                    JOIN sources ON sources.id=jobs.source_id""").fetchone()
        self.assertEqual(tuple(row), ('Google Jobs', 'job board', 'Found on Google Jobs via LinkedIn'))


if __name__ == '__main__':
    unittest.main()
