"""The job store: closing jobs of employer feeds the search no longer reads."""
import unittest

from src import store


class CloseDroppedTests(unittest.TestCase):
    """7 Oct 2026: jobs of employer feeds the search no longer reads are closed after the check, not after STALE_DAYS."""
    def test_a_dropped_feeds_jobs_close_boards_and_read_feeds_stay_and_a_broken_list_closes_nothing(self):
        import tempfile
        from datetime import datetime, timedelta, timezone
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'jobs.sqlite') as db:
            old = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(timespec='seconds')
            db.execute("INSERT INTO companies (id, name, updated_at) VALUES (1, 'X', ?)", (old,))
            db.executemany('INSERT INTO sources (id, name, kind) VALUES (?, ?, ?)', [(1, 'Netflix', 'employer feed'), (2, 'Migros', 'employer feed'), (3, 'jobs.ch', 'job board'),
                                                                                     (4, 'Manor', 'employer feed'), (5, 'Coop', 'employer feed')])
            for job_id, source in [(1, 1), (2, 2), (3, 3), (4, 4), (5, 5)]:
                db.execute("INSERT INTO jobs (id, canonical_key, source_id, company_id, title, url, first_seen_at, last_seen_at) VALUES (?, ?, ?, 1, 't', ?, ?, ?)",
                           (job_id, f'k{job_id}', source, f'u{job_id}', old, old))
            self.assertEqual(store.close_dropped(db, set()), 0, 'every feed gone at once: a broken list, nothing closed')
            self.assertEqual(store.close_dropped(db, {'Migros', 'Manor', 'Coop'}), 1)
            states = dict(db.execute('SELECT id, state FROM jobs').fetchall())
        self.assertEqual(states, {1: 'closed', 2: 'open', 3: 'open', 4: 'open', 5: 'open'})


if __name__ == '__main__':
    unittest.main()
