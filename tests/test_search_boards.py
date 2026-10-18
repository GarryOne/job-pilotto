"""Boards found by what a web search shows for the user's own queries (src/sources/search_boards.py, src/ai/board_ideas.py _searched): a result
address that carries the role and the place becomes a board; kept only when robots.txt allows it, it does not refuse us and its page lists 5 or
more jobs; asked once per strategy; nothing without a search provider. Fake search and pages only (a guard keeps real web search out of the
tests that reach board proposals)."""
import json
import re
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import board_ideas  # noqa: E402
from src.sources import careers, search_boards, web_search  # noqa: E402

_READER = careers.READER
HOST = 'listings.example'
SEARCH = {'jobs_board_search_queries': ['LKW Fahrer CE', 'Berufskraftfahrer'], 'role_keywords': ['berufskraftfahrer'], 'role_kinds': ['logistics'],
          'locations': {'top_tier': ['Nürnberg'], 'country_wide': [], 'abroad': []}}
SHAPES = ['https://{h}/stellenangebote-lkw%20fahrer%20ce-in-n%C3%BCrnberg', 'https://{h}/jobs/LKW+Fahrer+CE/Nuernberg',
          'https://{h}/search?q=LKW-Fahrer-CE&where=N%C3%BCrnberg', 'https://{h}/de/lkw_fahrer_ce_nurnberg.html']


def setUpModule():
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def listing(count):
    return ''.join(f'<div><a href="/job{1000000 + n}.html">LKW Fahrer {n}</a><a href="/job{1000000 + n}.html">Ansehen</a></div>' for n in range(count))


def job_page(url):
    posting = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'LKW Fahrer ' + url[-9:-5], 'url': url,
               'hiringOrganization': {'@type': 'Organization', 'name': 'Acme GmbH'},
               'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Nürnberg', 'addressCountry': 'DE'}}}
    return f'<html><script type="application/ld+json">{json.dumps(posting)}</script></html>'


def site(jobs=6, robots='User-agent: *\nAllow: /'):
    def fetch(url):
        if url.endswith('/robots.txt'):
            if isinstance(robots, int):
                raise urllib.error.HTTPError(url, robots, 'refused', {}, None)
            return robots
        return job_page(url) if re.search(r'/job\d', url) else listing(jobs)
    return fetch


class Fixture(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.dict('os.environ', {'JOB_PILOTTO_DISABLE': 'web_search'})):
            patch.start()
            self.addCleanup(patch.stop)


class TemplateTests(Fixture):
    def test_every_shape_of_a_search_address_becomes_a_template_with_the_role_and_the_place(self):
        for shape in SHAPES:
            with self.subTest(shape=shape):
                found = search_boards.template(shape.format(h=HOST), 'LKW Fahrer CE', 'Nürnberg')
                self.assertIn('{role}', found)
                self.assertTrue(found.startswith(f'https://{HOST}/'))
                self.assertNotRegex(found, r'(?i)lkw|fahrer')

    def test_only_the_whole_query_as_whole_words_makes_a_template(self):
        """A part of the query would make a board that asks for another role (Fahrer taken out of Berufskraftfahrer, 'results/fahrer-ce' for 'Fahrer Klasse CE')."""
        for url, query in ((f'https://{HOST}/jobs/berufskraftfahrer/in-n%C3%BCrnberg', 'Fahrer'), (f'https://{HOST}/results/fahrer-ce/in-bamberg', 'Fahrer Klasse CE'),
                           (f'https://{HOST}/results/lkw-fahrer-im-nahverkehr/in-erlangen', 'Fahrer CE')):
            with self.subTest(url=url):
                self.assertIsNone(search_boards.template(url, query, 'Nürnberg'))

    def test_an_address_without_the_role_is_not_a_search_page(self):
        self.assertIsNone(search_boards.template(f'https://{HOST}/about-us', 'LKW Fahrer CE', 'Nürnberg'))

    def test_one_board_per_host_never_a_known_board_a_portal_or_a_board_with_its_own_reader(self):
        addresses = [SHAPES[0].format(h=HOST), SHAPES[1].format(h=HOST),
                     'https://known.example/jobs/LKW+Fahrer+CE/Nuernberg', 'https://de.indeed.com/jobs?q=LKW+Fahrer+CE&l=N%C3%BCrnberg',
                     'https://www.jobs.ch/en/vacancies/?term=LKW+Fahrer+CE', 'https://other.example/about']
        boards = search_boards.candidates(addresses, 'LKW Fahrer CE', 'Nürnberg', {'known.example'}, ['Germany'])
        self.assertEqual([board['host'] for board in boards], [HOST])


class VerifyTests(Fixture):
    def board(self):
        return search_boards.candidates([SHAPES[0].format(h=HOST)], 'LKW Fahrer CE', 'Nürnberg', set(), ['Germany'])[0]

    def check(self, **kwargs):
        from src.sources import found_boards
        return search_boards.verify(self.board(), SEARCH, site(**kwargs), found_boards.read_board)

    def test_a_board_that_lists_five_or_more_jobs_is_kept(self):
        self.assertTrue(self.check(jobs=6))

    def test_fewer_than_five_jobs_is_not_a_board(self):
        self.assertFalse(self.check(jobs=4))

    def test_robots_that_disallow_the_page_or_refuse_the_file_are_a_no(self):
        self.assertFalse(self.check(robots='User-agent: *\nDisallow: /'))
        for code in (401, 403, 429):
            with self.subTest(code=code):
                self.assertFalse(self.check(robots=code))

    def test_a_missing_robots_file_allows(self):
        self.assertTrue(self.check(robots=404))


class FindTests(Fixture):
    def results(self, query):
        self.asked.append(query)
        return [SHAPES[0].format(h=HOST), SHAPES[1].format(h='other.example')]

    def setUp(self):
        super().setUp()
        self.asked = []

    def test_boards_come_from_the_results_of_the_strategys_own_queries(self):
        from src.sources import found_boards
        with mock.patch('src.sources.found_boards._places', return_value=['Nürnberg']):
            boards = search_boards.find(SEARCH, fetch=site(), results=self.results, read_board=found_boards.read_board)
        self.assertEqual([b['host'] for b in boards], [HOST, 'other.example'])
        self.assertEqual(len(self.asked), 2, 'one web search per query of the strategy (at most 3)')
        self.assertTrue(all('Nürnberg' in q for q in self.asked))

    def test_the_search_is_asked_once_per_strategy_and_only_with_a_provider(self):
        data = {}
        with mock.patch.object(web_search, 'provider', return_value=None), mock.patch.object(search_boards, 'find') as find:
            self.assertEqual(board_ideas._searched(data, 'k', SEARCH, [], []), [])
            find.assert_not_called()
            self.assertNotIn('searched', data, 'not kept without a provider: a later start with one asks')
        with mock.patch.object(web_search, 'provider', return_value='claude'), \
                mock.patch.object(search_boards, 'find', return_value=[{'name': 'x', 'host': 'x.example'}]) as find:
            self.assertEqual(board_ideas._searched(data, 'k', SEARCH, [], []), [{'name': 'x', 'host': 'x.example'}])
            self.assertEqual(board_ideas._searched(data, 'k', SEARCH, [], []), [{'name': 'x', 'host': 'x.example'}])
            find.assert_called_once()

    def test_a_search_that_fails_leaves_the_proposed_boards(self):
        with mock.patch.object(web_search, 'provider', return_value='claude'), mock.patch.object(search_boards, 'find', side_effect=RuntimeError('down')):
            self.assertEqual(board_ideas._searched({}, 'k', SEARCH, [], []), [])


class AskTests(Fixture):
    """A new site whose result addresses carry no query is asked for once; the address is judged by reading its page."""
    ADDRESSES = [f'https://{HOST}/anzeige123456.html', 'https://known.example/jobs/x', f'https://{HOST}/anzeige123457.html', 'https://de.indeed.com/x']

    def client(self, answer):
        reply = mock.Mock(content=[mock.Mock(type='text', text=json.dumps({'search_url': answer}))], usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0, cache_creation_input_tokens=0))
        return mock.Mock(messages=mock.Mock(create=mock.Mock(return_value=reply)))

    def test_a_valid_answer_on_the_sites_own_host_becomes_a_board_and_anything_else_is_dropped(self):
        for answer, kept in ((f'https://{HOST}/suche/{{role}}/{{place}}', True), ('https://elsewhere.example/q={role}', False), ('', False),
                             ('http://listings.example/{role}', False), (f'https://{HOST}/suche', False)):
            with self.subTest(answer=answer):
                board = search_boards.ask_address(HOST, self.ADDRESSES[:1], 'LKW Fahrer CE', 'Nürnberg', ['Germany'], client=self.client(answer))
                self.assertEqual(bool(board), kept)

    def test_a_model_that_fails_leaves_the_site_out(self):
        broken = mock.Mock(messages=mock.Mock(create=mock.Mock(side_effect=RuntimeError('down'))))
        self.assertIsNone(search_boards.ask_address(HOST, [], 'q', 'p', [], client=broken))

    def test_only_new_sites_are_asked_each_once_and_at_most_six(self):
        asked = []
        addresses = [f'https://site{n}.example/anzeige{n}00000.html' for n in range(9)] + ['https://known.example/x', 'https://de.indeed.com/x'] * 2
        def ask(host, examples, query, place, countries):
            asked.append(host)
        search_boards.find(SEARCH, known={'known.example'}, fetch=site(), results=lambda q: addresses, read_board=lambda *a, **k: ([], 'empty', None), ask=ask)
        self.assertEqual(len(asked), search_boards.MAX_ASKS)
        self.assertEqual(len(set(asked)), len(asked))
        self.assertFalse({'known.example', 'de.indeed.com'} & set(asked))

    def test_an_asked_board_is_kept_only_when_its_page_lists_five_or_more_jobs(self):
        from src.sources import found_boards
        def ask(host, examples, query, place, countries):
            return {**board_ideas.valid({'name': host, 'search_url': f'https://{host}/s/{{role}}/{{place}}', 'countries': ['Germany']}), 'via': 'search'}
        for jobs, kept in ((6, True), (3, False)):
            with self.subTest(jobs=jobs):
                found = search_boards.find(SEARCH, fetch=site(jobs=jobs), results=lambda q: self.ADDRESSES[:1], read_board=found_boards.read_board, ask=ask)
                self.assertEqual(bool(found), kept)


class GuardTests(unittest.TestCase):
    def test_every_test_file_that_reaches_board_proposals_keeps_real_web_search_off(self):
        """18 Oct 2026: board_ideas.ideas now asks a web search; a test that reached it with Claude Code installed would search the web."""
        here = Path(__file__).resolve().parent
        reaching = re.compile(r'board_ideas\.ideas\(|board_yield\.step\(|found_boards\.read\(|boards\.main\(')
        missing = [f.name for f in sorted(here.glob('test_*.py')) if f.name != Path(__file__).name and reaching.search(f.read_text())
                   and "'JOB_PILOTTO_DISABLE': 'web_search'" not in f.read_text() and 'web_search' not in f.read_text()]
        self.assertEqual(missing, [])


if __name__ == '__main__':
    unittest.main()
