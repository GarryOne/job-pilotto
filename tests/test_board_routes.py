"""Routes a board declares itself when its search page gives nothing (src/sources/board_routes.py): an RSS/Atom alternate, the sitemap in robots.txt
leading to JobPosting pages, a JSON feed alternate; the working route kept per host; 'browser' boards retried after 30 days; a refusal still stops."""
import json
import sys
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import board_ideas  # noqa: E402
from src.sources import found_boards  # noqa: E402
from src.sources import careers  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'jobs_board_search_queries': ['fahrer'], 'role_keywords': ['driver'], 'locations': {'top_tier': ['Giessen'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Stellen', 'host': 'stellen.example', 'search_url': 'https://stellen.example/suche?q={role}&ort={place}', 'countries': ['Germany'], 'kinds': ['any']}
SHELL = '<html><head>{head}</head><body><div id="root"></div><script src="/app.js"></script></body></html>'
RSS_HEAD = '<link rel="alternate" type="application/rss+xml" href="/feed/jobs.xml">'
RSS = ('<?xml version="1.0"?><rss version="2.0"><channel><title>Stellen</title>'
       '<item><title>Berufskraftfahrer CE</title><link>https://stellen.example/job/1001</link><description>&lt;p&gt;Fernverkehr ab Nürnberg&lt;/p&gt;</description>'
       '<pubDate>Fri, 16 Oct 2026 08:00:00 GMT</pubDate></item>'
       '<item><title>Kurierfahrer</title><link>https://stellen.example/job/1002</link></item></channel></rss>')
ATOM = ('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Lagerist</title><link rel="alternate" href="https://stellen.example/job/2001"/>'
        '<updated>2026-10-16T08:00:00Z</updated><summary>Lager Nürnberg</summary></entry></feed>')


def posting(n, title):
    return '<html><script type="application/ld+json">' + json.dumps({
        '@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': f'https://stellen.example/job/{n}',
        'hiringOrganization': {'@type': 'Organization', 'name': 'Spedition Nord'},
        'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Nürnberg', 'addressCountry': 'DE'}}}) + '</script></html>'


def site(pages):
    """A fetch over fixed pages; an address not in it is a 404."""
    asked = []

    def fetch(url):
        asked.append(url)
        if url in pages:
            if isinstance(pages[url], Exception):
                raise pages[url]
            return pages[url]
        raise urllib.error.HTTPError(url, 404, 'Not found', None, None)
    fetch.asked = asked
    return fetch


class BoardRoutesTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)
        self.search_url = 'https://stellen.example/suche?q=fahrer&ort=Giessen'

    def read(self, pages, now=None):
        fetch = site(pages)
        return found_boards.read(SEARCH, [BOARD], fetch=fetch, now=now), fetch

    def entry(self):
        return board_ideas.load()['boards']['stellen.example']

    def test_a_script_only_page_that_declares_an_rss_feed_is_read_from_the_feed(self):
        jobs, _ = self.read({self.search_url: SHELL.format(head=RSS_HEAD), 'https://stellen.example/feed/jobs.xml': RSS})
        self.assertEqual([(j['title'], j['url']) for j in jobs], [('Berufskraftfahrer CE', 'https://stellen.example/job/1001'), ('Kurierfahrer', 'https://stellen.example/job/1002')])
        self.assertEqual((self.entry()['state'], self.entry()['route']['kind']), ('ok', 'feed'))

    def test_an_atom_alternate_is_read_too(self):
        head = '<link rel="alternate" type="application/atom+xml" href="https://stellen.example/atom">'
        jobs, _ = self.read({self.search_url: SHELL.format(head=head), 'https://stellen.example/atom': ATOM})
        self.assertEqual([(j['title'], j['url']) for j in jobs], [('Lagerist', 'https://stellen.example/job/2001')])

    def test_robots_sitemap_leads_to_job_pages_with_jobposting_data(self):
        sitemap = '<urlset>' + ''.join(f'<url><loc>https://stellen.example/job/{n}</loc></url>' for n in (3001, 3002)) + '<url><loc>https://stellen.example/impressum</loc></url></urlset>'
        jobs, _ = self.read({self.search_url: SHELL.format(head=''), 'https://stellen.example/robots.txt': 'User-agent: *\nSitemap: https://stellen.example/sm.xml\n',
                             'https://stellen.example/sm.xml': sitemap, 'https://stellen.example/job/3001': posting(3001, 'Fahrer CE'), 'https://stellen.example/job/3002': posting(3002, 'Fahrer C')})
        self.assertEqual(sorted(j['title'] for j in jobs), ['Fahrer C', 'Fahrer CE'])
        self.assertEqual({j['company'] for j in jobs}, {'Spedition Nord'})
        self.assertEqual(self.entry()['route']['kind'], 'sitemap')

    def test_a_json_feed_alternate_is_read(self):
        head = '<link rel="alternate" type="application/feed+json" href="/feed.json">'
        feed = json.dumps({'version': 'https://jsonfeed.org/version/1.1', 'items': [{'id': '9', 'title': 'Busfahrer', 'url': 'https://stellen.example/job/9', 'content_text': 'Linie 5'}]})
        jobs, _ = self.read({self.search_url: SHELL.format(head=head), 'https://stellen.example/feed.json': feed})
        self.assertEqual([j['title'] for j in jobs], ['Busfahrer'])
        self.assertEqual(self.entry()['route']['kind'], 'json')

    def test_the_route_that_worked_is_used_first_on_the_next_run(self):
        pages = {self.search_url: SHELL.format(head=RSS_HEAD), 'https://stellen.example/feed/jobs.xml': RSS}
        self.read(pages)
        jobs, fetch = self.read(pages)
        self.assertEqual(len(jobs), 2)
        self.assertEqual(fetch.asked[0], 'https://stellen.example/feed/jobs.xml')

    def test_a_board_with_no_route_is_still_marked_browser(self):
        jobs, _ = self.read({self.search_url: SHELL.format(head='')})
        self.assertEqual((jobs, self.entry()['state'], 'route' in self.entry()), ([], 'browser', False))

    def test_a_refusal_on_a_route_stops_at_once(self):
        refused = urllib.error.HTTPError('x', 403, 'Forbidden', None, None)
        jobs, fetch = self.read({self.search_url: SHELL.format(head=RSS_HEAD), 'https://stellen.example/feed/jobs.xml': refused,
                                 'https://stellen.example/robots.txt': 'Sitemap: https://stellen.example/sm.xml'})
        self.assertEqual((jobs, self.entry()['state']), ([], 'browser'))
        self.assertNotIn('https://stellen.example/robots.txt', fetch.asked)

    def test_a_bot_check_page_is_not_tried_for_routes(self):
        refused = urllib.error.HTTPError('x', 429, 'Slow down', None, None)
        _, fetch = self.read({self.search_url: refused, 'https://stellen.example/robots.txt': 'Sitemap: https://stellen.example/sm.xml'})
        self.assertEqual(fetch.asked, [self.search_url])
        self.assertEqual(self.entry()['state'], 'browser')

    def test_a_route_that_stops_working_falls_back_to_the_page(self):
        pages = {self.search_url: SHELL.format(head=RSS_HEAD), 'https://stellen.example/feed/jobs.xml': RSS}
        self.read(pages)
        pages['https://stellen.example/feed/jobs.xml'] = '<rss><channel></channel></rss>'
        jobs, _ = self.read(pages)
        self.assertEqual((jobs, self.entry()['state']), ([], 'browser'))
        self.assertNotIn('route', self.entry())

    def test_a_browser_board_is_read_again_after_30_days_not_before(self):
        pages = {self.search_url: SHELL.format(head='')}
        start = datetime(2026, 10, 1, tzinfo=timezone.utc)
        self.read(pages, now=start)
        _, fetch = self.read(pages, now=start + timedelta(days=29))
        self.assertEqual(fetch.asked, [])
        pages['https://stellen.example/feed/jobs.xml'] = RSS
        pages[self.search_url] = SHELL.format(head=RSS_HEAD)
        jobs, _ = self.read(pages, now=start + timedelta(days=31))
        self.assertEqual((len(jobs), self.entry()['state']), (2, 'ok'))

    def test_xml_with_an_entity_declaration_is_not_parsed(self):
        evil = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa">]><rss><channel><item><title>&a;</title><link>https://stellen.example/job/1</link></item></channel></rss>'
        jobs, _ = self.read({self.search_url: SHELL.format(head=RSS_HEAD), 'https://stellen.example/feed/jobs.xml': evil})
        self.assertEqual(jobs, [])


if __name__ == '__main__':
    unittest.main()
