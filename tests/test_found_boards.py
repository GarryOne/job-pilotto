"""Reading the boards found for the user's countries (src/sources/found_boards.py): a public search page read like a careers page, its
employer taken from the page's own job data, a refusing board marked for a visit and never fetched again, an empty one dropped after 3."""
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import found_boards  # noqa: E402

SEARCH = {'jobs_board_search_queries': ['programador'], 'role_keywords': ['developer'],
          'locations': {'top_tier': ['Lisboa'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Empregos', 'host': 'empregos.example', 'search_url': 'https://empregos.example/procura?q={role}&local={place}',
         'countries': ['Portugal'], 'kinds': ['any']}
JOB = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'Programador Python', 'url': 'https://empregos.example/oferta/1',
       'hiringOrganization': {'@type': 'Organization', 'name': 'Acme Lda'},
       'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Lisboa', 'addressCountry': 'PT'}}, 'datePosted': '2026-10-07'}
PAGE = f'<html><script type="application/ld+json">{json.dumps(JOB)}</script><body>Programador</body></html>'


class FoundBoardsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_board_is_read_with_your_own_search_and_place_and_its_employer(self):
        asked = []
        jobs = found_boards.read(SEARCH, [BOARD], fetch=lambda url: asked.append(url) or PAGE)
        self.assertEqual(asked, ['https://empregos.example/procura?q=programador&local=Lisboa'])
        self.assertEqual([(j['title'], j['company'], j['url']) for j in jobs], [('Programador Python', 'Acme Lda', 'https://empregos.example/oferta/1')])

    def test_a_refusing_board_becomes_a_visit_and_is_never_fetched_again(self):
        def refuse(url):
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        self.assertEqual(found_boards.read(SEARCH, [BOARD], fetch=refuse), [])
        asked = []
        found_boards.read(SEARCH, [BOARD], fetch=lambda url: asked.append(url) or PAGE)
        self.assertEqual(asked, [])
        from src.ai import board_ideas
        self.assertEqual(board_ideas.load()['boards']['empregos.example']['state'], 'browser')

    def test_a_board_that_finds_nothing_three_times_is_dropped(self):
        for _ in range(3):
            found_boards.read(SEARCH, [BOARD], fetch=lambda url: '<html><body><p>Sem resultados para a sua pesquisa. ' + 'Experimente outras palavras ou outra zona. ' * 30 + '</p></body></html>')
        from src.ai import board_ideas
        self.assertEqual(board_ideas.load()['boards']['empregos.example']['state'], 'dead')


    def test_a_board_that_only_a_browser_reads_is_offered_as_a_visit(self):
        from src.sources import visits_portals
        def refuse(url):
            raise urllib.error.HTTPError(url, 429, 'Too many', None, None)
        found_boards.read(SEARCH, [BOARD], fetch=refuse)
        offered = [p for p in visits_portals.portals(SEARCH) if p['key'].startswith('board:')]
        self.assertEqual([(p['name'], p['url']) for p in offered], [('Empregos', 'https://empregos.example/procura?q=developer&local=Lisboa')])   # the first role word, as LinkedIn and Indeed


if __name__ == '__main__':
    unittest.main()
