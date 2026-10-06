"""A careers page with no open jobs today ('watch', looked at again weekly) is written to Notion like every other outcome.
6 Oct 2026: write_notion had no Feed status for it, so the run warned "Notion not updated for <company>: KeyError: 'watch'"."""
import json
import unittest
from pathlib import Path

from src import scout


class FakeTracker:
    def __init__(self):
        self.created = []

    def query_database(self, *_):
        return []

    def create_page(self, _db, props):
        self.created.append(props)


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
        tracker = FakeTracker()
        candidate = {'name': 'Example Careers AG', 'tier': 'Tier 2', 'origin': 'list', 'careers': 'https://example.test/careers'}
        scout.write_notion(tracker, candidate, {'status': 'watch', 'ats': 'greenhouse', 'slug': 'example'})
        self.assertEqual(tracker.created[0]['Feed status'], {'select': {'name': 'No open jobs'}})
        self.assertEqual(tracker.created[0]['Active'], {'checkbox': False})


if __name__ == '__main__':
    unittest.main()
