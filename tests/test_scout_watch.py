"""A careers page with no open jobs today ('watch', looked at again weekly) is written to the employers like every other outcome.
6 Oct 2026: the Notion write had no Feed status for it, so the run warned "Notion not updated for <company>: KeyError: 'watch'"."""
import json
import unittest
from pathlib import Path

from src import scout
from src.stores import memory


class WatchOutcome(unittest.TestCase):
    def test_every_outcome_has_a_feed_status_in_the_schema(self):
        schema = json.loads(Path('config/notion_schema.json').read_text())
        options = set()

        def walk(node):
            if isinstance(node, dict):
                if 'Feed status' in node:
                    options.update(o['name'] for o in node['Feed status']['options'])
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)
        walk(schema)
        for status in ('found', 'low', 'manual', 'none', 'watch'):
            self.assertIn(scout.FEED_STATUS[status], options, status)

    def test_a_watched_careers_page_is_written(self):
        stores = memory.open_store()
        candidate = {'name': 'Example Careers AG', 'tier': 'Tier 2', 'origin': 'list', 'careers': 'https://example.test/careers'}
        scout.write_employer(stores, candidate, {'status': 'watch', 'ats': 'greenhouse', 'slug': 'example'})
        [row] = stores.employers.list(active=None)
        self.assertEqual((row['feed_status'], row['active']), ('No open jobs', False))


if __name__ == '__main__':
    unittest.main()
