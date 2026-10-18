"""Jobs a board page ships as embedded JSON state (src/sources/board_state.py): found by the shape of the data (a list of records with a
title, a link and more fields), never by a site's name; a list of menu links is not jobs. Fixtures are the SHAPES: a window assignment and a
JSON script tag."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import board_routes, board_state  # noqa: E402

BOARD = {'name': 'Arbeit', 'host': 'arbeit.example'}
ROWS = [{'id': i, 'title': t, 'url': f'/job/{i}00123/{t.lower().replace(" ", "-")}', 'company': {'name': c}, 'location': {'city': 'Berlin'}, 'posted': '2026-10-1%d' % i}
        for i, (t, c) in enumerate([('Musiker Orchester', 'Staatsoper'), ('Tontechniker', 'Studio Nord'), ('Chorleiter', 'Kirche Mitte')], 1)]
MENU = [{'label': 'Gerontologie', 'url': '/jobs/gerontologie'}, {'label': 'Innere Medizin', 'url': '/jobs/innere-medizin'}, {'label': 'Pflege', 'url': '/jobs/pflege'}]
STATE = {'ui': {'menu': MENU}, 'search': {'results': {'items': ROWS, 'total': 3}}}
ASSIGNED = f'<html><body><script>window.__PRELOADED_STATE__ = {json.dumps(STATE)};window.__OTHER__ = 1;</script></body></html>'
TAGGED = f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps({"props": {"pageProps": STATE}})}</script></html>'


class BoardStateTests(unittest.TestCase):
    def test_records_are_read_from_a_window_assignment_and_from_a_json_script(self):
        for page in (ASSIGNED, TAGGED):
            jobs = board_state.jobs(page, 'https://arbeit.example/suche?q=x', BOARD)
            self.assertEqual([(j['title'], j['company'], j['url']) for j in jobs],
                             [('Musiker Orchester', 'Staatsoper', 'https://arbeit.example/job/100123/musiker-orchester'),
                              ('Tontechniker', 'Studio Nord', 'https://arbeit.example/job/200123/tontechniker'),
                              ('Chorleiter', 'Kirche Mitte', 'https://arbeit.example/job/300123/chorleiter')])

    def test_a_list_of_menu_links_is_not_jobs(self):
        page = f'<script>window.__PRELOADED_STATE__ = {json.dumps({"menu": MENU})};</script>'
        self.assertEqual(board_state.jobs(page, 'https://arbeit.example/', BOARD), [])

    def test_broken_or_huge_json_gives_nothing(self):
        self.assertEqual(board_state.jobs('<script>window.__S__ = {"a": [1,2;</script><script type="application/json">{nope</script>', 'https://x.example/', BOARD), [])

    def test_a_board_whose_page_has_state_is_read_through_discover_and_kept_as_a_route(self):
        jobs, route = board_routes.discover(ASSIGNED, 'https://arbeit.example/suche?q=x', lambda url: '', BOARD, ['musiker'])
        self.assertEqual((len(jobs), route['kind']), (3, 'state'))
        again = board_routes.follow(route, lambda url: ASSIGNED, BOARD, ['musiker'])
        self.assertEqual([j['title'] for j in again], [j['title'] for j in jobs])


if __name__ == '__main__':
    unittest.main()
