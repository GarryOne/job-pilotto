"""Job aggregators with public APIs (src/sources/aggregators.py) and role words in other languages (src/coverage.py LOCAL_VOCAB). No network."""
import json
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import coverage  # noqa: E402
from src.sources import aggregators, feeds  # noqa: E402

NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)
TITLE, PLACE = 'Site Reliability Engineer / Data Analyst', 'Zürich, Switzerland; Amsterdam, Netherlands'   # matches the example search and the owner's


class AggregatorTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(feeds.wanted_title(TITLE) and feeds.wanted_location({'location': PLACE}))

    def test_the_end_to_end_fixture_mode_never_reaches_a_live_api(self):
        # 3 Oct 2026: real jobicy rows landed in the e2e quality suite's data. Fixture mode reads files only, like careers.py.
        db = sqlite3.connect(':memory:')
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': '/tmp/fixtures'}), mock.patch.object(aggregators, 'sources', side_effect=AssertionError('a live source was asked')):
            self.assertEqual(aggregators.scan(db, {}, now=NOW), {'jobs': [], 'sources': []})
        # a test of scan itself, with its own readers, is unaffected
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': '/tmp/fixtures'}):
            self.assertEqual(aggregators.scan(db, {}, now=NOW, readers=[])['jobs'], [])

    def test_each_free_source_is_read_into_the_common_job_shape_with_its_own_address(self):
        pages = {'arbeitnow': {'data': [{'slug': 's1', 'company_name': 'Acme', 'title': TITLE, 'location': PLACE, 'url': 'https://arbeitnow.example/s1',
                                         'created_at': 1791028823, 'description': '<p>Kubernetes</p>', 'remote': False}]},
                 'himalayas': {'jobs': [{'guid': 'https://himalayas.app/x', 'title': TITLE, 'companyName': 'Beta', 'locationRestrictions': ['Switzerland'],
                                         'applicationLink': 'https://himalayas.app/x', 'pubDate': 1791028823, 'description': 'd'}]},
                 'jobicy': {'jobs': [{'id': 7, 'jobTitle': TITLE, 'companyName': 'Gamma', 'jobGeo': 'EMEA', 'url': 'https://jobicy.com/jobs/7', 'pubDate': '2026-10-01T00:00:00+00:00'}]}}
        get = lambda url, *a: next(v for k, v in pages.items() if k in url)
        job, = aggregators.arbeitnow(lambda url: pages['arbeitnow'] if 'page=1' in url else {'data': []})
        self.assertEqual((job['company'], job['url'], job['description'], job['date_posted']), ('Acme', 'https://arbeitnow.example/s1', 'Kubernetes', '2026-10-03'))
        self.assertEqual(aggregators.himalayas(get)[0]['location'], 'Remote (Switzerland)')
        self.assertEqual(aggregators.jobicy(get, tags=('devops',))[0]['url'], 'https://jobicy.com/jobs/7')

    def test_only_your_roles_and_places_are_kept_each_job_names_its_source_and_a_source_waits_six_hours(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        jobs = [aggregators._job('x', 1, TITLE, 'Acme', PLACE, 'https://a.example/1'), aggregators._job('x', 2, 'Office Manager', 'Acme', PLACE, 'https://a.example/2'),
                aggregators._job('x', 3, TITLE, 'Acme', 'Tokyo, Japan', 'https://a.example/3')]
        with mock.patch.object(feeds, 'record', return_value='new'):
            report = aggregators.scan(db, {}, NOW, readers=[('Arbeitnow', lambda search: jobs)])
            again = aggregators.scan(db, {}, NOW + timedelta(hours=1), readers=[('Arbeitnow', lambda search: self.fail('too soon'))])
            later = aggregators.scan(db, {}, NOW + timedelta(hours=7), readers=[('Arbeitnow', lambda search: [])])
        self.assertEqual([(j['title'], j['source'], j['notes']) for j in report['jobs']], [(TITLE, 'Arbeitnow', 'Found on Arbeitnow')])
        self.assertEqual(report['sources'], [{'company': 'Arbeitnow', 'ok': True, 'total': 3, 'matches': 1}])
        self.assertEqual(again['sources'], [])
        self.assertEqual(later['sources'][0]['ok'], True)

    def test_a_failing_source_is_reported_not_raised(self):
        db = sqlite3.connect(':memory:')
        def broken(search):
            raise OSError('down')
        report = aggregators.scan(db, {}, NOW, readers=[('Jobicy', broken)])
        self.assertEqual(report['sources'], [{'company': 'Jobicy', 'ok': False, 'error': 'OSError: down'}])

    def test_keyed_sources_only_with_their_keys_and_free_ones_can_be_switched_off(self):
        names = lambda env: [name for name, _ in aggregators.sources(env)]
        self.assertEqual(names({}), ['Arbeitnow', 'Himalayas', 'Jobicy'])
        self.assertEqual(names({'ADZUNA_APP_ID': 'i', 'ADZUNA_APP_KEY': 'k', 'JOOBLE_API_KEY': 'j'}), ['Arbeitnow', 'Himalayas', 'Jobicy', 'Adzuna', 'Jooble'])
        self.assertEqual(names({'JOB_PILOTTO_DISABLE': 'aggregators', 'JOOBLE_API_KEY': 'j'}), ['Jooble'])

    def test_adzuna_asks_per_country_of_your_places(self):
        asked = []
        search = {'role_keywords': ['devops'], 'locations': {'top_tier': ['\\bz[uü]rich\\b'], 'country_wide': [], 'abroad': ['\\blondon\\b']}}
        with mock.patch.dict('os.environ', {'ADZUNA_APP_ID': 'i', 'ADZUNA_APP_KEY': 'k'}):
            aggregators.adzuna(search, lambda url: asked.append(url) or {'results': []})
        self.assertEqual([u.split('/jobs/')[1].split('/')[0] for u in asked], ['ch', 'gb'])


class LocalLanguageTests(unittest.TestCase):
    def test_role_words_in_other_languages_are_counted_and_make_the_card_speak(self):
        tally = coverage.Tally()
        for title in ('Systemtechniker (m/w/d)', 'ICT Systemtechniker 100%', 'Systemtechniker Cloud', 'Ingénieur système Linux'):
            tally.add(title, in_place=True, matched=False, location='Zürich')
        tally.add('Site Reliability Engineer', in_place=True, matched=True, location='Zürich')
        verdict = coverage.verdict(tally.summary(), ['site reliability'], [])
        first = verdict['suggestions'][0]
        self.assertEqual((first['term'], first['count'], first['local']), ('systemtechniker', 3, True))
        self.assertTrue(verdict['narrow'] and verdict['local'], 'three missed local-language titles are worth saying even when the search is broad')


if __name__ == '__main__':
    unittest.main()
