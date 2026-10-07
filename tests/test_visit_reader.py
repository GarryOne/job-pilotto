"""How to read a job list on any site, learned once (7 Oct 2026): Claude's recipe is checked against the outline, kept per site, forgotten
when it stops finding jobs."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src.ai import visit_reader
from src.sources import visits

OUTLINE = {'url': 'https://shop.example/carriere', 'title': 'Carrière', 'pager': [{'label': '→ Suivante'}, {'label': '2'}],
           'groups': [{'id': 'g1', 'selector': 'div.tiles > div.tile', 'count': 12, 'samples': [{'lines': ['Vendeuse', 'Boutique Rive', 'Genève'], 'links': []}]},
                      {'id': 'g2', 'selector': 'nav > a', 'count': 6, 'samples': [{'lines': ['Accueil'], 'links': []}]}]}


def client(answer):
    reply = SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(answer))], usage=SimpleNamespace(input_tokens=1, output_tokens=1))
    return SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: reply))


class RecipeTest(unittest.TestCase):
    def test_a_recipe_names_a_listed_group_real_lines_and_a_paging_label_the_page_has(self):
        recipe = visit_reader.understand(OUTLINE, client({'group': 'g1', 'title': 0, 'company': 1, 'place': 2, 'link': 0, 'next': '→ Suivante', 'why': 'tiles'}))
        self.assertEqual((recipe['selector'], recipe['title'], recipe['place'], recipe['next']), ('div.tiles > div.tile', 0, 2, '→ Suivante'))
        made_up = visit_reader.understand(OUTLINE, client({'group': 'g1', 'title': 9, 'company': 1, 'place': -1, 'link': 0, 'next': 'Next page', 'why': ''}))
        self.assertEqual((made_up['title'], made_up['next']), (-1, 'none'), 'an index past the lines and a label the page lacks are not used')
        self.assertIsNone(visit_reader.understand(OUTLINE, client({'group': 'g9', 'title': 0, 'company': -1, 'place': -1, 'link': 0, 'next': 'none', 'why': ''})))

    def test_a_recipe_is_kept_per_site_and_forgotten_when_it_stops_working(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(visits, 'STORE', Path(tmp) / 'visits.json'):
            visits.save_recipe('https://shop.example/carriere?page=2', {'selector': 'div.tile', 'next': 'number'})
            self.assertEqual(visits.recipe_for('https://www.shop.example/other')['selector'], 'div.tile', 'one recipe per site')
            visits.forget_recipe('https://shop.example/x')
            self.assertIsNone(visits.recipe_for('https://shop.example/carriere'))


if __name__ == '__main__':
    unittest.main()
