"""A board's own section for the user's kind of work (src/sources/board_sections.py), opened when its home page gave no relevant job (24 Oct 2026:
a Moldovan board's home page was news and its IT section listed 100 jobs). Fixture shapes: a static section page, a hub of sections, a section built by scripts."""
import unittest
from unittest import mock

from src.sources import board_pages, board_sections, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


HOME = 'https://jobs.example/'
NAV = ('<a href="/stiri">Știri</a><a href="/angajatori">Angajatori</a><a href="/it">Tech și programare</a><a href="/vanzari">Vânzări</a>'
       '<a href="https://other.example/x">Partener</a><a href="/lucrari" >Toate joburile</a>')


def posting(n):
    return ('<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer %d","hiringOrganization":{"name":"Acme"},'
            '"jobLocation":{"address":{"addressLocality":"Chișinău","addressCountry":"MD"}},"url":"https://jobs.example/job/%d"}</script>' % (n, n))


SECTION = '<html>' + ''.join(posting(n) for n in range(3)) + '</html>'
SHELL = '<html><body><div id="app"></div><script src="/app.js"></script></body></html>'


def decider(by_text):
    """A stand-in for the AI: the answer is chosen from the link text it is given (a language the code knows nothing of)."""
    def decide(topic, items, answers, instructions):
        return {key: by_text.get(text.split('\n')[0].removeprefix('Link text: '), 'other') for key, text in items.items()}
    return decide


def fetcher(pages):
    return lambda url: pages.get(url, '')


class PickTests(unittest.TestCase):
    def test_the_links_of_the_boards_own_site_only_one_per_path(self):
        found = board_sections.candidates(NAV + '<a href="/it?page=2">Tech</a>', HOME)
        self.assertEqual([text for _, text in found], ['Știri', 'Angajatori', 'Tech și programare', 'Vânzări', 'Toate joburile'])

    def test_the_ai_answer_picks_sections_and_hubs(self):
        decide = decider({'Tech și programare': 'best', 'Toate joburile': 'hub'})
        self.assertEqual(board_sections.pick(NAV, HOME, 'software engineer', decide), (['https://jobs.example/it'], ['https://jobs.example/lucrari']))


    def test_the_exact_field_comes_before_near_ones_whatever_the_page_order(self):
        """24 Oct 2026: the AI marked 21 of a board's fields as sections and the first two in page order (acquisitions, naval) were read, never IT."""
        decide = decider({'Știri': 'near', 'Angajatori': 'near', 'Vânzări': 'near', 'Tech și programare': 'best'})
        sections, _ = board_sections.pick(NAV, HOME, 'software engineer', decide)
        self.assertEqual(sections, ['https://jobs.example/it', 'https://jobs.example/stiri'])

    def test_no_ai_answer_picks_nothing(self):
        self.assertEqual(board_sections.pick(NAV, HOME, 'software engineer', lambda *a: None), ([], []))

    def test_the_cache_key_names_the_role_so_another_role_asks_again(self):
        seen = []
        board_sections.pick(NAV, HOME, 'nurse', lambda t, items, a, i: seen.append(list(items)) or {})
        self.assertTrue(all(key.startswith('nurse|') for key in seen[0]))


class ReadTests(unittest.TestCase):
    def read(self, pages, decide, home=NAV):
        with mock.patch.object(board_pages, 'allowed', return_value=True):
            return board_sections.read(home, HOME, 'software engineer', fetcher(pages), decide, lambda jobs: jobs)

    def test_a_static_section_page_gives_its_jobs(self):
        jobs, url = self.read({'https://jobs.example/it': SECTION}, decider({'Tech și programare': 'best'}))
        self.assertEqual((len(jobs), url), (3, 'https://jobs.example/it'))

    def test_a_hub_is_opened_and_its_section_read(self):
        hub = '<a href="/it">Tech și programare</a><a href="/vanzari">Vânzări</a>'
        jobs, url = self.read({'https://jobs.example/lucrari': hub, 'https://jobs.example/it': SECTION},
                              decider({'Toate joburile': 'hub', 'Tech și programare': 'best'}))
        self.assertEqual((len(jobs), url), (3, 'https://jobs.example/it'))

    def test_a_section_built_by_scripts_gives_nothing_and_breaks_nothing(self):
        self.assertEqual(self.read({'https://jobs.example/it': SHELL}, decider({'Tech și programare': 'best'})), ([], None))

    def test_a_section_robots_txt_forbids_is_not_fetched(self):
        with mock.patch.object(board_pages, 'allowed', return_value=False):
            self.assertEqual(board_sections.read(NAV, HOME, 'x', fetcher({'https://jobs.example/it': SECTION}), decider({'Tech și programare': 'best'}),
                                                 lambda jobs: jobs), ([], None))


class WiredTests(unittest.TestCase):
    def test_another_way_reads_the_section_when_the_proposed_link_gave_nothing(self):
        board = {'name': 'Example', 'host': 'jobs.example', 'search_url': HOME + 'q?w={role}'}
        search = {'jobs_board_search_queries': 'software engineer'}
        careers.READER = 'auto'
        try:
            with mock.patch.object(board_pages, 'allowed', return_value=True), mock.patch('src.ai.decide.decide', decider({'Tech și programare': 'best'})):
                entry = {}
                jobs, state, relevant = found_boards._another_way(board, entry, board['search_url'], search, fetcher({HOME: NAV, HOME + 'it': SECTION}),
                                                                  lambda found: found, ([], 'empty', []))
        finally:
            careers.READER = None
        self.assertEqual((len(jobs), state, entry['search_url']), (3, 'ok', HOME + 'it'))


if __name__ == '__main__':
    unittest.main()
