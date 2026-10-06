"""Employers checked while the app had no Notion reach Employers & Sources later (6 Oct 2026: three Find new employers runs made
while trying the app, Breitling's feed among them, never reached the user's Notion after they connected it)."""
import json
import sqlite3
import unittest
from unittest import mock

from src import scout


class FakeTracker:
    def __init__(self, fail=()):
        self.rows, self.fail = {}, set(fail)

    def query_database(self, _db, query):
        name = query['title']['equals']
        return [{'id': name}] if name in self.rows else []

    def create_page(self, _db, props):
        name = props['Company']['title'][0]['text']['content']
        if name in self.fail:
            raise RuntimeError('Notion busy')
        self.rows[name] = props

    def update_page(self, page_id, props):
        self.rows[page_id] = props


def checked_db():
    db = sqlite3.connect(':memory:')
    db.executescript(scout.TABLES)
    rows = [('breitling', 'Breitling', 'found', 'successfactors', 'careers.breitling.com', 55,
             {'places': ['Geneva'], 'relevant': 10, 'preferred': 2, 'jobs': 40, 'swiss': 2, 'stack_share': 0, 'salary_published': False}),
            ('rolex', 'Rolex', 'low', 'greenhouse', 'rolex', 10, None),
            ('aldi', 'Aldi Suisse', 'watch', 'careers', 'jobs.aldi.ch', None, None),
            ('fnac', 'Fnac Suisse', 'none', None, None, None, None)]   # no feed, not Tier 1: kept on this computer only, by design
    for key, name, status, system, slug, score, stats in rows:
        db.execute("""INSERT INTO scout_candidates (key, name, origin, priority, tier, ats, slug, status, quality, stats_json, added_at, checked_at)
            VALUES (?, ?, 'AI idea 2026-10-06', 1, 'Standard', ?, ?, ?, ?, ?, '2026-10-06', '2026-10-06T20:15:26+00:00')""",
                   (key, name, system, slug, status, score, json.dumps(stats) if stats else None))
    db.execute("""INSERT INTO scout_candidates (key, name, origin, priority, added_at) VALUES ('lidl', 'Lidl Suisse', 'AI idea', 1, '2026-10-06')""")
    return db


class SyncNotion(unittest.TestCase):
    def test_employers_checked_without_notion_are_written_once_connected(self):
        db, tracker = checked_db(), FakeTracker()
        with mock.patch.object(scout, 'EMPLOYERS_DB', 'employers-1'):
            self.assertEqual(scout.sync_notion(db, None), (0, 0))                 # still trying the app: nothing to write to
            self.assertEqual(scout.sync_notion(db, tracker), (4, 0))
            self.assertEqual(sorted(tracker.rows), ['Aldi Suisse', 'Breitling', 'Rolex'])   # Lidl was never checked; Fnac stays local
            self.assertEqual(tracker.rows['Breitling']['Feed status'], {'select': {'name': 'Feed found'}})
            self.assertEqual(tracker.rows['Breitling']['ATS'], {'select': {'name': 'successfactors'}})
            self.assertEqual(scout.sync_notion(db, tracker), (0, 0))              # nothing twice
        with mock.patch.object(scout, 'EMPLOYERS_DB', 'employers-2'):            # another workspace connected later gets them all
            other = FakeTracker()
            self.assertEqual(scout.sync_notion(db, other), (4, 0))
            self.assertIn('Breitling', other.rows)

    def test_a_failed_write_is_tried_again_next_time(self):
        db = checked_db()
        with mock.patch.object(scout, 'EMPLOYERS_DB', 'employers-1'):
            self.assertEqual(scout.sync_notion(db, FakeTracker(fail={'Rolex'})), (3, 1))
            again = FakeTracker()
            self.assertEqual(scout.sync_notion(db, again), (1, 0))
            self.assertEqual(list(again.rows), ['Rolex'])


if __name__ == '__main__':
    unittest.main()
