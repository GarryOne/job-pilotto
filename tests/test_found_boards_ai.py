"""The AI page reader on a found board (src/sources/found_boards.py, owner's yes 18 Oct 2026): only when every free step (JobPosting, job
links, feeds/sitemaps, embedded page state) found nothing on an open, readable page; once per board per run; the recipe it leaves makes the
next read free. A walled or script-only page is never sent. Fake model only; recipes kept in memory."""
import re
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats, careers, found_boards, page_recipes  # noqa: E402

SEARCH = {'jobs_board_search_queries': ['programador', 'developer'], 'role_keywords': ['developer'],
          'locations': {'top_tier': ['Lisboa', 'Porto'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Empregos', 'host': 'empregos.example', 'search_url': 'https://empregos.example/procura?q={role}&local={place}'}
TITLES = ['Programador Python', 'Programador Java', 'Engenheiro de Dados']
CARDS = ''.join(f'<div class="card"><a href="/v/{i}">{t}</a> · Lisboa</div>' for i, t in enumerate(TITLES, 1))
TEXT = '<html><body>' + '<p>Encontre ofertas de emprego e candidate-se nas melhores empresas da sua região.</p>' * 20 + CARDS + '</body></html>'
SHELL = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>'
ANSWER = [ats._job(f'https://empregos.example/v/{i}', t, 'Lisboa', f'https://empregos.example/v/{i}') for i, t in enumerate(TITLES, 1)]


class BoardAiTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        saved = careers.READER, careers.RENDER, careers.CHOOSER
        careers.READER, careers.RENDER, careers.CHOOSER = 'auto', None, None
        self.addCleanup(lambda: (setattr(careers, 'READER', saved[0]), setattr(careers, 'RENDER', saved[1]), setattr(careers, 'CHOOSER', saved[2])))
        self.asked, self.recipes = [], {}
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(careers, 'reader', return_value=lambda url, markup, **kw: self.asked.append(url) or ANSWER),
                      mock.patch.object(page_recipes, 'load', side_effect=lambda url: self.recipes.get(url)),
                      mock.patch.object(page_recipes, 'save', side_effect=lambda url, recipe, **kw: self.recipes.update({url: recipe})),
                      mock.patch.object(page_recipes, 'mark_broken')):
            patch.start()
            self.addCleanup(patch.stop)

    def page(self, body):
        return lambda url: body if 'procura' in url else ''

    def test_an_open_page_no_free_step_reads_is_read_once_by_the_ai_and_then_by_its_recipe(self):
        jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=self.page(TEXT))
        self.assertEqual((state, sorted(j['title'] for j in jobs), len(self.asked)), ('ok', sorted(TITLES), 1))   # 2 searches x 2 places: one AI read
        self.assertEqual(self.recipes[self.asked[0]]['kind'], 'links')
        again, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=self.page(TEXT))
        self.assertEqual((state, len(again), len(self.asked)), ('ok', 3, 1))   # the next run: the recipe, no model

    def test_a_script_only_page_is_never_sent_to_the_ai(self):
        jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=self.page(SHELL))
        self.assertEqual((jobs, state, self.asked), ([], 'browser', []))

    def test_a_walled_page_is_never_sent_to_the_ai(self):
        def refuse(url):
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        self.assertEqual(found_boards.read_board(BOARD, SEARCH, fetch=refuse)[1:], ('browser', None))
        self.assertEqual(self.asked, [])

    def test_a_page_a_free_step_reads_is_never_sent_to_the_ai(self):
        state = '{"r": [' + ','.join(f'{{"title": "{t}", "url": "/v/{i}", "company": "Acme", "city": "Lisboa"}}' for i, t in enumerate(TITLES, 1)) + ']}'
        jobs, found_state, route = found_boards.read_board(BOARD, SEARCH, fetch=self.page(TEXT.replace('</body>', f'<script>window.__S__ = {state};</script></body>')))
        self.assertEqual((found_state, route['kind'], self.asked), ('ok', 'state', []))


class NoRealModelTests(unittest.TestCase):
    def test_every_test_file_that_reads_boards_turns_the_page_reader_off(self):
        """A board read may now ask the AI page reader; the default engine (Claude Code) is always 'ready', so a test file that reaches a
        board read without this fixture could start a real model call on a developer's Mac."""
        reads = re.compile(r'found_boards\.(read|read_board)\(|first_jobs\.\w+\(|aggregators\.scan\(')   # the calls that reach a board read
        tests = Path(__file__).resolve().parent
        missing = [f.name for f in sorted(tests.glob('test_*.py')) if f.name != Path(__file__).name
                   and reads.search(f.read_text(encoding='utf-8')) and 'careers.READER = None' not in f.read_text(encoding='utf-8')]
        self.assertEqual(missing, [])


if __name__ == '__main__':
    unittest.main()
