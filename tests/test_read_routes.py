"""How a site's posting text is read (route facts): recorded per site by describe, shared as fixed words, never a text or an address."""
import pathlib
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from unittest import mock

from src import contribute
from src.sources import describe, read_routes, visits

JOB = 'A posting about selling watches in Geneva. ' * 20


class ReadRouteTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.mkdtemp()
        patches = [mock.patch.object(visits, 'STORE', pathlib.Path(tmp) / 'visits.json'), mock.patch('src.paths.DATA', pathlib.Path(tmp))]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def backfill(self, urls, page_text):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE jobs (id INTEGER PRIMARY KEY, url TEXT, state TEXT, description TEXT, first_seen_at TEXT)')
        now = datetime.now(timezone.utc)
        db.executemany('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)', [(i, u, 'open', '', now.isoformat(timespec='seconds')) for i, u in enumerate(urls)])
        with mock.patch.object(describe, 'page_text', page_text):
            return describe.backfill(db, now=now)

    def test_each_outcome_is_recorded_as_one_fixed_word_per_site(self):
        def page_text(url, opener=None):
            if 'closed' in url:
                raise describe.Refused('HTTP 403')
            if 'scripts' in url:
                return ''
            describe._ROUTE.route = 'jobposting' if 'tagged' in url else 'main'
            return JOB
        self.backfill(['https://jobs.tagged.test/1', 'https://careers.plain.test/2', 'https://www.closed.test/3', 'https://scripts.test/4'], page_text)
        facts = {f['host']: f['route'] for f in read_routes.facts()}
        self.assertEqual(facts, {'tagged.test': 'jobposting', 'plain.test': 'main', 'closed.test': 'refused', 'scripts.test': 'browser_only'})

    def test_shared_facts_carry_a_host_and_a_word_only(self):
        read_routes.record('https://jobs.tagged.test/secret/path?name=Anna', 'jobposting')
        fact = next(f for f in contribute.site_facts() if f['kind'] == 'route')
        self.assertEqual(fact, {'host': 'tagged.test', 'kind': 'route', 'route': 'jobposting'}, 'no address, no query, no text')

    def test_an_unknown_word_or_a_sign_in_site_is_never_recorded(self):
        read_routes.record('https://a.test/1', 'whatever')
        read_routes.record('https://ch.linkedin.com/jobs/view/3', 'refused')
        self.assertEqual(read_routes.facts(), [])

    def test_the_most_common_route_is_the_one_shared(self):
        for route in ('main', 'main', 'refused'):
            read_routes.record('https://a.test/1', route)
        self.assertEqual(read_routes.facts(), [{'host': 'a.test', 'kind': 'route', 'route': 'main'}])

    def test_the_employer_index_gives_routes_back_to_the_install(self):
        import json
        index = pathlib.Path(tempfile.mkdtemp()) / 'index.json'
        index.write_text(json.dumps({'sites': [{'host': 'a.test', 'kind': 'route', 'route': 'refused'}, {'host': 'b.test', 'kind': 'route', 'route': 'x'}]}))
        with mock.patch('src.employer_index.CACHE', index):
            self.assertEqual(visits.pool_facts().get('route'), {'a.test': 'refused'})

    def test_served_routes_are_read_back_by_site_and_bad_ones_dropped(self):
        served = [{'host': 'a.test', 'kind': 'route', 'route': 'refused'}, {'host': 'b.test', 'kind': 'route', 'route': 'bogus'},
                  {'kind': 'route', 'route': 'main'}]
        self.assertEqual(read_routes.served(served), {'a.test': 'refused'})


if __name__ == '__main__':
    unittest.main()
