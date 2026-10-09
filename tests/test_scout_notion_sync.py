"""Employers checked before the store had them reach it later (6 Oct 2026: three Find new employers runs made while trying the app,
Breitling's feed among them, never reached the user's Notion after they connected it). Any store: the memory one here; a Notion
store's marks are per Employers & Sources database (`database_id`), so another workspace connected later gets them all."""
import json
import sqlite3
import unittest

from src import scout
from src.stores import memory


def employer_list(database_id=None, fail=()):
    """A memory store; with database_id, its employers stand for one Notion Employers & Sources database. fail: names refused."""
    stores = memory.open_store()
    if database_id:
        stores.employers.database_id = database_id
    upsert = stores.employers.upsert

    def refusing(employer):
        if employer['name'] in fail:
            raise RuntimeError('Notion busy')
        return upsert(employer)
    stores.employers.upsert = refusing
    return stores


def names(stores):
    return sorted(e['name'] for e in stores.employers.list(active=None))


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
    db.execute("""INSERT INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES ('successfactors', 'careers.breitling.com', 'Breitling', 'Standard', 55, '2026-10-06')""")
    # A duplicate: the same feed as one already read under another name, stored as 'found' so it is not checked again, never given a row.
    db.execute("""INSERT INTO scout_candidates (key, name, origin, priority, tier, ats, slug, status, quality, added_at, checked_at)
        VALUES ('breitlingwatches', 'Breitling Watches', 'AI idea', 1, 'Standard', 'successfactors', 'careers.breitling.com', 'found', 55, '2026-10-06', '2026-10-06T20:15:27+00:00')""")
    return db


class SyncEmployers(unittest.TestCase):
    def test_employers_checked_before_the_store_had_them_are_written_once(self):
        db, stores = checked_db(), employer_list('employers-1')
        self.assertEqual(scout.sync_employers(db, None), (0, 0))                 # nowhere to write
        self.assertEqual(scout.sync_employers(db, stores), (4, 0))
        self.assertEqual(names(stores), ['Aldi Suisse', 'Breitling', 'Rolex'])   # Lidl was never checked; Fnac stays local; the duplicate never
        breitling = next(e for e in stores.employers.list() if e['name'] == 'Breitling')
        self.assertEqual((breitling['feed_status'], breitling['ats']), ('Feed found', 'successfactors'))
        self.assertEqual(scout.sync_employers(db, stores), (0, 0))              # nothing twice
        other = employer_list('employers-2')                                     # another workspace connected later gets them all
        self.assertEqual(scout.sync_employers(db, other), (4, 0))
        self.assertIn('Breitling', names(other))

    def test_the_store_on_this_mac_gets_them_too(self):
        """A user not on Notion: the employers go to this Mac's store (the Employers screen reads it), once."""
        db, stores = checked_db(), employer_list()
        self.assertEqual(scout.sync_employers(db, stores), (4, 0))
        self.assertEqual(names(stores), ['Aldi Suisse', 'Breitling', 'Rolex'])
        self.assertEqual(scout.sync_employers(db, stores), (0, 0))

    def test_a_notion_store_without_employers_database_writes_nothing(self):
        stores = employer_list()
        stores.employers.database_id = ''
        self.assertEqual(scout.sync_employers(checked_db(), stores), (0, 0))

    def test_a_failed_write_is_tried_again_next_time(self):
        db = checked_db()
        self.assertEqual(scout.sync_employers(db, employer_list('employers-1', fail={'Rolex'})), (3, 1))
        again = employer_list('employers-1')
        self.assertEqual(scout.sync_employers(db, again), (1, 0))
        self.assertEqual(names(again), ['Rolex'])


if __name__ == '__main__':
    unittest.main()
