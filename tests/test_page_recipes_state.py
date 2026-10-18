"""The 'state' recipe kind (src/sources/page_recipes.py + board_state.py): a page that carries its result list as embedded JSON whose records
have too few fields for the generic reader is learned once from the model's answer (the path to the list), then replayed with no model.
Fake model only."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats, careers, page_recipes  # noqa: E402

BASE = 'https://stellen.example/suche?q=koch'
ROWS = [{'t': 'x', 'title': title, 'link': f'/job/{i}00123/{title.lower()}'} for i, title in enumerate(['Koch', 'Beikoch', 'Küchenchef', 'Jungkoch'], 1)]
OTHER = [{'label': name, 'link': f'/jobs/{name}'} for name in ('a', 'b', 'c')]
PAGE = '<body>' + '<p>Stellen in deiner Nähe finden und dich direkt bewerben.</p>' * 40 + f'<script>window.__DATA__ = {json.dumps({"nav": OTHER, "hits": {"list": ROWS}})};</script></body>'
ANSWER = [ats._job(f'x{i}', row['title'], '', f'https://stellen.example{row["link"]}') for i, row in enumerate(ROWS)]


class StateRecipeTests(unittest.TestCase):
    def test_a_state_recipe_is_derived_from_the_models_answer_and_replays_without_it(self):
        recipe = page_recipes.derive(PAGE, BASE, ANSWER)
        self.assertEqual(recipe, {'kind': 'state', 'path': '0.hits.list'})
        self.assertEqual([t for t, _ in page_recipes.replay(recipe, PAGE, BASE)], ['Koch', 'Beikoch', 'Küchenchef', 'Jungkoch'])

    def test_a_state_recipe_has_a_fixed_shape_and_safe_values(self):
        self.assertTrue(page_recipes.valid({'kind': 'state', 'path': '0.a.b.3.c'}))
        for bad in ({'kind': 'state'}, {'kind': 'state', 'path': ''}, {'kind': 'state', 'path': 'a.b'}, {'kind': 'state', 'path': '0.a b'},
                    {'kind': 'state', 'path': '0.a', 'x': 1}, {'kind': 'state', 'path': '0.' + 'a.' * 20 + 'b'}, {'kind': 'state', 'path': '0.__proto__;x'}):
            self.assertFalse(page_recipes.valid(bad), bad)

    def test_a_list_the_model_did_not_read_is_not_the_recipe(self):
        answer = [ats._job('z', 'Unrelated', '', 'https://stellen.example/z')] * 3
        self.assertNotEqual((page_recipes.derive(PAGE, BASE, answer) or {}).get('path'), '0.hits.list')

    def test_a_page_whose_data_moved_reads_nothing_and_the_recipe_is_flagged_broken(self):
        self.assertEqual(page_recipes.replay({'kind': 'state', 'path': '0.gone.list'}, PAGE, BASE), [])

    def test_the_model_is_asked_once_and_the_next_read_needs_none(self):
        saved = careers.READER, careers.RENDER, careers.CHOOSER
        careers.READER, careers.RENDER, careers.CHOOSER = 'auto', None, None
        self.addCleanup(lambda: (setattr(careers, 'READER', saved[0]), setattr(careers, 'RENDER', saved[1]), setattr(careers, 'CHOOSER', saved[2])))
        asked, kept = [], {}
        with mock.patch.object(careers, 'reader', return_value=lambda url, markup, **kw: asked.append(url) or ANSWER), \
                mock.patch.object(page_recipes, 'load', side_effect=lambda url: kept.get(url)), \
                mock.patch.object(page_recipes, 'save', side_effect=lambda url, recipe, **kw: kept.update({url: recipe})):
            careers._asked(BASE, PAGE, [], fetch_page=lambda url: '')
            again = careers._asked(BASE, PAGE, [], fetch_page=lambda url: '')
        self.assertEqual((len(asked), kept[BASE]['kind'], [j['title'] for j in again][:2]), (1, 'state', ['Koch', 'Beikoch']))


if __name__ == '__main__':
    unittest.main()
