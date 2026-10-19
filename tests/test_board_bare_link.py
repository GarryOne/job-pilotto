"""A proposed board link with an extra filter that empties the results is read again with only its search words and place (owner, 19 Oct 2026:
Arbeitsagentur's "&branche=Medien" gave "Keine Ergebnisse" for Musiker in Berlin; without it, the job list). src/sources/found_boards.py."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import careers, found_boards, page_recipes  # noqa: E402
from tests.test_found_boards_ai import ANSWER, BOARD, SEARCH, TEXT, TITLES  # noqa: E402

NONE = '<html><body>' + '<p>Nenhum resultado para esta pesquisa. Experimente outras palavras.</p>' * 20 + '</body></html>'


class BareTests(unittest.TestCase):
    def test_only_the_parts_with_the_search_words_and_place_stay(self):
        self.assertEqual(found_boards._bare('https://www.arbeitsagentur.de/jobsuche/suche?was={role}&wo={place}&branche=Medien'),
                         'https://www.arbeitsagentur.de/jobsuche/suche?was={role}&wo={place}')
        self.assertEqual(found_boards._bare('https://www.medienboard.de/suche?tx_kesearch_pi1%5Bsword%5D={role}&page=2'),
                         'https://www.medienboard.de/suche?tx_kesearch_pi1%5Bsword%5D={role}')
        self.assertEqual(found_boards._bare('https://www.stepstone.de/jobs/{role}/in-{place}?radius=30'), 'https://www.stepstone.de/jobs/{role}/in-{place}')

    def test_a_link_with_nothing_to_drop_has_no_bare_form(self):
        for url in ('https://www.kimeta.de/jobs?q={role}&l={place}', 'https://www.stepstone.de/jobs/{role}/in-{place}'):
            self.assertIsNone(found_boards._bare(url), url)


class AnotherWayTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        saved = careers.READER, careers.RENDER
        careers.READER, careers.RENDER = 'auto', None
        self.addCleanup(lambda: (setattr(careers, 'READER', saved[0]), setattr(careers, 'RENDER', saved[1])))
        self.fetched = []
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(careers, 'reader', return_value=lambda url, markup, **kw: ANSWER if 'card' in markup else []),
                      mock.patch.object(page_recipes, 'load', return_value=None), mock.patch.object(page_recipes, 'save'),
                      mock.patch.object(page_recipes, 'mark_broken'),
                      mock.patch.object(found_boards.board_forms, 'home', return_value=('https://empregos.example/', '')),
                      mock.patch.object(found_boards.board_forms, 'home_templates', return_value=[])):
            patch.start()
            self.addCleanup(patch.stop)

    def fetch(self, url):
        self.fetched.append(url)
        return NONE if 'sector=' in url else TEXT

    def another_way(self, proposed):
        entry = {}
        board = {**BOARD, 'search_url': proposed}
        result = found_boards._another_way(board, entry, proposed, SEARCH, self.fetch, lambda jobs: [job for job in jobs if job['title'] in TITLES], ([], 'empty', []))
        return result, entry

    def test_a_filter_that_empties_the_results_is_dropped_and_the_bare_link_kept(self):
        (jobs, state, relevant), entry = self.another_way(BOARD['search_url'] + '&sector=Media')
        self.assertEqual((state, sorted(job['title'] for job in relevant)), ('ok', sorted(TITLES)))
        self.assertEqual(entry['search_url'], BOARD['search_url'], 'the bare link is the one read next time')
        self.assertEqual(entry['form_for'], BOARD['search_url'] + '&sector=Media', 'once per proposed link')

    def test_a_bare_link_that_also_gives_nothing_leaves_the_board_as_it_was(self):
        self.fetch = lambda url: self.fetched.append(url) or NONE
        result, entry = self.another_way(BOARD['search_url'] + '&sector=Media')
        self.assertEqual(result, ([], 'empty', []))
        self.assertNotIn('search_url', entry)
        self.assertTrue(any('sector=' not in url for url in self.fetched), 'the bare link was tried')

    def test_a_link_with_nothing_to_drop_is_not_read_again(self):
        self.another_way(BOARD['search_url'])
        self.assertEqual([url for url in self.fetched if '/procura' in url], [], 'no second read of the same link')


if __name__ == '__main__':
    unittest.main()
