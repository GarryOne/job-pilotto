"""A board whose job list is built by scripts although its page has text is read in the headless browser (src/sources/found_boards.py _rendered), and
from then on (24 Oct 2026: a Moldovan board's list page held 7 menu links statically and 36 job cards after its scripts ran)."""
import json
import unittest

from src.sources import careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


HOME = 'https://jobs.example/'
BOARD = {'name': 'Example', 'host': 'jobs.example', 'search_url': HOME + 'jobs/?q={role}', 'countries': ['Moldova'], 'kinds': ['any']}
SEARCH = {'jobs_board_search_queries': ['software engineer']}
TEXT = '<p>' + 'Locuri de muncă în Moldova, angajatori și articole. ' * 30 + '</p>'
STATIC = '<html><body>' + TEXT + '<a href="/about">Despre</a><a href="/blog">Blog</a></body></html>'
RENDERED = '<html><body>' + TEXT + ''.join(f'<a href="/job/software-engineer-{n}/{12000 + n}/">Software Engineer {n}</a>' for n in range(6)) + '</body></html>'


def job_page(url):
    posting = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Software Engineer ' + url.split('/')[-2], 'url': url,
               'hiringOrganization': {'@type': 'Organization', 'name': 'Acme'}, 'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Chișinău', 'addressCountry': 'MD'}}}
    return f'<html><script type="application/ld+json">{json.dumps(posting)}</script></html>'


def fetch(url):
    return job_page(url) if '/job/' in url else STATIC


class RenderedTests(unittest.TestCase):
    def test_a_script_built_list_is_read_after_its_scripts_ran_and_kept(self):
        entry, shown = {}, []
        def show(url):
            shown.append(url)
            return RENDERED
        found = found_boards._rendered(BOARD, entry, BOARD['search_url'], (HOME, STATIC), SEARCH, fetch, show, lambda jobs: jobs)
        self.assertEqual((len(found[0]), found[1], entry.get('rendered')), (6, 'ok', True))
        self.assertEqual(shown, [HOME + 'jobs/?q=software+engineer'])

    def test_no_browser_or_a_refusal_changes_nothing(self):
        self.assertIsNone(found_boards._rendered(BOARD, {}, BOARD['search_url'], (HOME, STATIC), SEARCH, fetch, None, lambda jobs: jobs))
        def refuse(url):
            raise OSError('blocked')
        entry = {}
        self.assertIsNone(found_boards._rendered(BOARD, entry, BOARD['search_url'], (HOME, STATIC), SEARCH, fetch, refuse, lambda jobs: jobs))
        self.assertNotIn('rendered', entry)

    def test_a_rendered_page_without_a_relevant_job_is_not_kept(self):
        entry = {}
        self.assertIsNone(found_boards._rendered(BOARD, entry, BOARD['search_url'], (HOME, STATIC), SEARCH, fetch, lambda url: RENDERED, lambda jobs: []))
        self.assertNotIn('rendered', entry)

    def test_a_board_marked_rendered_reads_through_the_browser_from_then_on(self):
        board = {**BOARD, 'rendered': True}
        jobs, state, _ = found_boards.read_board(board, SEARCH, fetch=fetch, show=lambda url: RENDERED)
        self.assertEqual((len(jobs), state), (6, 'ok'))


if __name__ == '__main__':
    unittest.main()
