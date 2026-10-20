"""The central scout's published dead ends keep every employer of the last 30 days up to a cap, and drop the oldest first (20 Oct 2026: the list
sat at its old cap of 5,000, so names past it were probed again)."""
import sqlite3
import unittest

from src import scout_index
from src.scout_core import ensure_tables, now


class DeadEndsTest(unittest.TestCase):
    def setUp(self):
        self.db = ensure_tables(sqlite3.connect(':memory:'))

    def test_more_than_the_old_cap_are_published(self):
        day = now().date().isoformat()
        shared = [{'key': f'co{n}', 'company': f'Co {n}', 'host': None, 'last': day} for n in range(6000)]
        self.assertEqual(len(scout_index.dead_ends(self.db, shared)), 6000)

    def test_past_the_cap_the_oldest_drop_out(self):
        today = now().date()
        shared = [{'key': f'old{n}', 'last': (today - scout_index.timedelta(days=5)).isoformat()} for n in range(scout_index.MAX_DEAD_ENDS)]
        shared += [{'key': 'fresh', 'last': today.isoformat()}]
        out = scout_index.dead_ends(self.db, shared)
        self.assertEqual(len(out), scout_index.MAX_DEAD_ENDS)
        self.assertEqual(out[0]['key'], 'fresh', 'the newest stays whatever its place in the list')


if __name__ == '__main__':
    unittest.main()
