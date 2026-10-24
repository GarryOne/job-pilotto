"""A board's search page that lists its jobs as links differing only in a long number is read by that shape, whatever the site calls them
(src/sources/careers_parse.py numbered_links). 18 Oct 2026: a job site listed 17 truck-driver jobs as /<word><id>.html, no word of ours matched
and the board read 0. One test loops over several invented shapes (class test); the guards: menus, categories and too few numbers are not jobs."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import careers, careers_parse, found_boards  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


HOST = 'listings.example'
SHAPES = ['/vaga{id}.html', '/emploi/{id}', '/p/x{id}', '/{id}-poste.php', '/angebot-{id}/ansehen']   # invented words and places of the id
SEARCH = {'jobs_board_search_queries': ['motorista'], 'role_keywords': ['motorista'], 'locations': {'top_tier': ['Porto'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Listings', 'host': HOST, 'search_url': f'https://{HOST}/busca?q={{role}}&local={{place}}', 'countries': ['Portugal'], 'kinds': ['any']}


def card(shape, number, title):
    link = shape.format(id=number)
    return f'<div class="card"><a href="{link}">{title}</a><a href="{link}">Ver</a></div>'


def job_page(url, title):
    posting = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': url, 'hiringOrganization': {'@type': 'Organization', 'name': 'Acme Lda'},
               'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Porto', 'addressCountry': 'PT'}}}
    return f'<html><script type="application/ld+json">{json.dumps(posting)}</script></html>'


MENU = '<nav><a href="/sobre">Sobre</a><a href="/contacto">Contacto</a><a href="/vagas-motorista">Motorista</a></nav>'


class NumberedLinksTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)

    @staticmethod
    def listing(shape, count=6):
        return MENU + ''.join(card(shape, 1000000 + n, f'Motorista {n}') for n in range(count))

    def test_every_shape_of_a_numbered_list_is_read_as_jobs(self):
        for shape in SHAPES:
            with self.subTest(shape=shape):
                base = f'https://{HOST}/busca'
                urls = careers_parse.job_links(self.listing(shape), base)
                self.assertEqual(len(urls), 6, 'the six cards, once each, not the menu')
                self.assertTrue(all(url.startswith(f'https://{HOST}') and '1000' in url for url in urls))

    def test_a_board_read_returns_the_jobs_of_a_numbered_list(self):
        for shape in SHAPES:
            with self.subTest(shape=shape):
                def fetch(url, shape=shape):
                    if '/busca' in url:
                        return self.listing(shape)
                    return job_page(url, 'Motorista ' + url[-9:-4])
                jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=fetch)
                self.assertEqual((len(jobs), state), (6, 'ok'))
                self.assertEqual({job['company'] for job in jobs}, {'Acme Lda'})

    def test_a_menu_and_categories_with_no_numbers_are_not_jobs(self):
        self.assertEqual(careers_parse.job_links(MENU + '<a href="/cat/a">A</a><a href="/cat/b">B</a><a href="/cat/c">C</a>' * 3, f'https://{HOST}/busca'), [])

    def test_fewer_than_five_numbers_are_not_a_list(self):
        self.assertEqual(careers_parse.job_links(self.listing('/vaga{id}.html', count=4), f'https://{HOST}/busca'), [])

    def test_job_words_still_win_over_numbers(self):
        """A page whose job addresses a job word already finds keeps them; numbered footer links do not join."""
        footer = ''.join(f'<a href="/noticia{n}00000.html">n</a>' for n in range(1, 7))
        jobs = ''.join(f'<a href="/jobs/senior-motorista-{n}00000">j</a>' for n in range(1, 4))
        urls = careers_parse.job_links(jobs + footer, f'https://{HOST}/busca')
        self.assertTrue(urls and all('/jobs/' in url for url in urls), urls)

    def test_cards_with_a_title_slug_and_a_short_number_are_one_shape(self):
        """24 Oct 2026: a Moldovan board's 18 cards were /locuri-de-munca/<title>/<id>, ids of 4-6 digits, beside menu links with job words."""
        menu = '<a href="/lucru-in-chisinau">Caută de lucru în Chișinău</a><a href="/lucru-dupa-companii">Caută de lucru după companii</a><a href="/lucru-dupa-orase">Orașe</a>'
        cards = ''.join(f'<a href="/ro/locuri-de-munca/programator-{n}/{ident}">Programator {n}</a>' for n, ident in enumerate([4349, 78127, 144224, 144221, 141405, 125589]))
        urls = careers_parse.job_links(menu + cards, f'https://{HOST}/busca')
        self.assertEqual(len(urls), 6)
        self.assertTrue(all('/locuri-de-munca/' in url for url in urls), urls)

    def test_a_year_after_a_slug_is_not_a_card_number(self):
        posts = ''.join(f'<a href="/blog/post-{n}/{2020 + n}">p</a>' for n in range(6))
        self.assertEqual(careers_parse.job_links(posts, f'https://{HOST}/busca'), [])


if __name__ == '__main__':
    unittest.main()
