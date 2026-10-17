import sqlite3
import sys
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import scout, scout_candidates, scout_core, scout_queue


def memory_db():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    scout_core.ensure_tables(db)
    return db


def add(db, name, origin, status='pending', priority=60, added='2026-10-01'):
    db.execute('INSERT INTO scout_candidates (key, name, origin, priority, status, added_at, checked_with) VALUES (?, ?, ?, ?, ?, ?, ?)',
               (name.lower(), name, origin, priority, status, added, scout.READERS if status != 'pending' else None))


def owners_queue():
    """The shape of the owner's queue on 18 Oct 2026: a list that never yields ahead of the AI's ideas, which do."""
    db = memory_db()
    for i in range(6):
        add(db, f'Wb{i}done', 'hiring-without-whiteboards', 'none')
    for i in range(9):
        add(db, f'Ai{i}found', 'AI idea 2026-10-03', 'found')
    for i in range(8):
        add(db, f'Ai{i}none', 'AI idea 2026-10-03', 'none')
    add(db, 'Wbwaiting', 'hiring-without-whiteboards', priority=70)
    add(db, 'Aiwaiting', 'AI idea 2026-10-18', priority=60)
    add(db, 'Wikiwaiting', 'Wikidata: Switzerland', priority=50)
    add(db, 'Pasted', 'Pasted page 2026-10-18', priority=96)
    return db


class YieldOrderTest(unittest.TestCase):
    def test_names_are_checked_by_their_sources_yield_and_a_pasted_name_first(self):
        names = [c['name'] for c in scout.next_batch(owners_queue(), 4)]
        self.assertEqual(names, ['Pasted', 'Aiwaiting', 'Wikiwaiting', 'Wbwaiting'])

    def test_a_source_never_checked_gets_a_fair_start(self):
        shares = scout_queue.yields(owners_queue())
        self.assertAlmostEqual(scout_queue.share(shares, 'Wikidata: Switzerland'), 0.5)
        self.assertLess(shares['hiring-without-whiteboards'], 0.2)
        self.assertGreater(shares['AI idea'], scout_queue.share(shares, 'Wikidata: Switzerland'))


class ExpiryTest(unittest.TestCase):
    def test_a_source_with_no_feed_after_enough_checks_stops_waiting(self):
        db = memory_db()
        for i in range(scout_queue.EXPIRE_AFTER):
            add(db, f'Dead{i}', 'Some list', 'none')
        add(db, 'Deadwaiting', 'Some list')
        add(db, 'Livewaiting', 'Another list')
        add(db, 'Mine', 'Pasted page 2026-10-18', priority=96)
        self.assertEqual(scout_queue.expire(db), {'Some list': 1})
        self.assertEqual(db.execute("SELECT status FROM scout_candidates WHERE name = 'Deadwaiting'").fetchone()[0], 'expired')
        self.assertEqual([c['name'] for c in scout.next_batch(db, 10)], ['Mine', 'Livewaiting'])

    def test_one_feed_keeps_a_source_alive_and_too_few_checks_never_expire(self):
        db = memory_db()
        for i in range(scout_queue.EXPIRE_AFTER - 1):
            add(db, f'Dead{i}', 'Young list', 'none')
        add(db, 'Youngwaiting', 'Young list')
        for i in range(scout_queue.EXPIRE_AFTER * 2):
            add(db, f'Old{i}', 'Old list', 'none')
        add(db, 'Oldfound', 'Old list', 'found')
        add(db, 'Oldwaiting', 'Old list')
        self.assertEqual(scout_queue.expire(db), {})


class NoPauseTest(unittest.TestCase):
    def test_a_long_queue_still_takes_new_names(self):
        db = memory_db()
        for i in range(150):
            add(db, f'Waiting{i}', 'Hacker News: (September 2026)')
        with mock.patch.object(scout.employer_index, 'central_nofeed', return_value=set()):
            scout.run(db, batch=1, seeds={'excluded': []}, probe=lambda *a, **k: None, static=[], workers=1,
                      harvest_sources=[lambda: [dict(name='Brandnew', origin='Role search 2026-10-18', priority=91)]])
        self.assertIsNotNone(db.execute("SELECT 1 FROM scout_candidates WHERE name = 'Brandnew'").fetchone())


class CountryListsTest(unittest.TestCase):
    def test_a_countrys_own_lists_are_read_only_for_a_search_in_that_country(self):
        names = lambda countries: {getattr(s, 'list_name', '') for s in scout_candidates.default_sources(memory_db(), {}, countries)}
        self.assertTrue({'swissdevjobs', 'jobs.ch employers'} <= names(['Switzerland', 'Germany']))
        self.assertFalse({'swissdevjobs', 'jobs.ch employers'} & names(['Portugal']))
        self.assertIn('wikidata', names(['Portugal']))


if __name__ == '__main__':
    unittest.main()
