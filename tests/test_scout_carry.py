"""The central scout verifies its feeds in slices: the longest-unread first, the rest carried over, so a run always ends in time. No network."""
import tempfile
import time
import unittest
from pathlib import Path

from src import scout, scout_carry, store as job_store


def job(title='Engineer'):
    return [{'id': '1', 'title': title, 'location': 'Zurich', 'url': 'u', 'date_posted': '2099-01-01', 'description': '', 'remote': False, 'salary': ''}]


class CarryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = job_store.connect(Path(self.tmp.name) / 'j.sqlite').__enter__()
        self.db.executescript(scout.TABLES)
        self.starter = [{'company': f'Co {i}', 'ats': 'lever', 'slug': f'co{i}'} for i in range(60)]   # fictional

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_run_cut_short_carries_the_feeds_it_read_last_time_and_reads_the_unread_ones_first(self):
        feeds, _ = scout.build_index(self.db, self.starter, lambda s, slug: job(), today='2026-10-20', carry=True)
        self.assertEqual(len(feeds), 60)   # first run: all read and kept
        calls = []
        def slow(system, slug):
            calls.append(slug)
            time.sleep(0.05)
            return job()
        self.starter.append({'company': 'New Co', 'ats': 'lever', 'slug': 'newco'})
        feeds, _ = scout.build_index(self.db, self.starter, slow, today='2026-10-21', workers=1, carry=True, deadline=time.monotonic() + 0.2)
        self.assertEqual(calls[0], 'newco')   # never-read first
        self.assertLess(len(calls), 61)       # cut short
        self.assertEqual(len(feeds), 60 + 1 - (0 if 'newco' in calls else 1))   # the others carried over, none lost
        self.assertTrue(any(f['checked'] == '2026-10-20' for f in feeds))   # a carried entry keeps its real read date

    def test_a_feed_not_read_for_a_week_is_not_carried(self):
        scout.build_index(self.db, self.starter[:3], lambda s, slug: job(), today='2026-10-01', carry=True)
        feeds, _ = scout.build_index(self.db, self.starter[:3], lambda s, slug: job(), today='2026-10-20', carry=True, deadline=time.monotonic() - 1)
        self.assertEqual(feeds, [])

    def test_without_carry_nothing_is_kept(self):
        scout.build_index(self.db, self.starter[:3], lambda s, slug: job(), today='2026-10-20')
        self.assertEqual(self.db.execute("SELECT name FROM sqlite_master WHERE name = 'feed_entries'").fetchall(), [])
