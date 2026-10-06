"""The pool's finer labels: a search's words become fixed ids only, and the site accepts exactly the ids the engine sends."""
import re
import unittest
from pathlib import Path

from src import pool_tags


class PoolTagsTest(unittest.TestCase):
    def test_a_photographer_in_geneva_is_ch_geneva_photography_and_nothing_free(self):
        self.assertEqual(pool_tags.places(['Genève', 'Lausanne', 'Suisse romande']), (['ch'], ['ch-geneva', 'ch-lausanne']))
        self.assertEqual(pool_tags.families(['photographe', 'assistant photo', 'retoucheur']), ['photography'])
        self.assertEqual(pool_tags.places(['Chișinău']), (['md'], ['md-chisinau']))

    def test_the_site_accepts_the_same_ids(self):
        site = (Path(__file__).resolve().parents[1] / 'site' / 'src' / 'pool-tags.js').read_text()
        for name, table in (('COUNTRIES', pool_tags.COUNTRIES), ('METROS', pool_tags.METROS), ('FAMILIES', pool_tags.FAMILIES)):
            listed = re.search(rf'export const {name} = \[(.*?)\];', site).group(1)
            self.assertEqual(re.findall(r"'([^']+)'", listed), list(table), f'{name}: run the generator in this test file\'s docstring history or edit site/src/pool-tags.js')


if __name__ == '__main__':
    unittest.main()
