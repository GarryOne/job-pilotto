"""The job store: a job's state (open, unmatched, expired), closing jobs of feeds the search no longer reads, and pruning old ones."""
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
        self.assertEqual(states, {1: 'expired', 2: 'open', 3: 'open', 4: 'open', 5: 'open'})


class StatesAndPruneTests(unittest.TestCase):
    """10 Oct 2026 (owner: "closed is not clear"): a job outside your search is unmatched, a posting that went away is expired; rows written as
    'closed' before are sorted into the two; unmatched or expired jobs unseen for 60 days and never acted on are removed with their AI results."""
    def _db(self, tmp):
        from pathlib import Path
        db = store.connect(Path(tmp) / 'jobs.sqlite')
        db.execute("INSERT INTO companies (id, name, updated_at) VALUES (1, 'X', '2026-01-01')")
        db.execute("INSERT INTO sources (id, name, kind) VALUES (1, 'jobs.ch', 'job board')")
        return db

    def _job(self, db, job_id, location, state, seen):
        db.execute("INSERT INTO jobs (id, canonical_key, source_id, company_id, title, url, location, state, first_seen_at, last_seen_at) VALUES (?, ?, 1, 1, 'Vendeur', ?, ?, ?, ?, ?)",
                   (job_id, f'k{job_id}', f'https://x/{job_id}', location, state, seen, seen))
        db.execute("INSERT INTO applications (job_id, status, updated_at) VALUES (?, 'unreviewed', ?)", (job_id, seen))

    def test_old_closed_rows_are_sorted_into_unmatched_and_expired_by_the_search(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp, self._db(tmp) as db:
            self._job(db, 1, 'Genève', 'closed', '2026-10-01')    # fits the search: it closed because the posting went away
            self._job(db, 2, 'St. Gallen', 'closed', '2026-10-01')   # outside the places: unmatched
            self._job(db, 3, 'St. Gallen', 'open', '2026-10-09')
            store.close_elsewhere(db, lambda job: job['location'] == 'Genève')
            states = dict(db.execute('SELECT id, state FROM jobs').fetchall())
        self.assertEqual(states, {1: 'expired', 2: 'unmatched', 3: 'unmatched'})

    def test_prune_removes_only_old_unmatched_or_expired_jobs_never_acted_on_with_their_ai_results(self):
        import tempfile
        from datetime import datetime, timezone
        now = datetime(2026, 12, 31, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as tmp, self._db(tmp) as db:
            self._job(db, 1, 'Bern', 'expired', '2026-09-01')     # old, untouched: removed
            self._job(db, 2, 'Bern', 'unmatched', '2026-09-01')   # old, untouched: removed
            self._job(db, 3, 'Bern', 'expired', '2026-12-20')     # seen recently: kept (it may come back)
            self._job(db, 4, 'Bern', 'open', '2026-09-01')        # open: kept
            self._job(db, 5, 'Bern', 'expired', '2026-09-01')     # you applied: kept
            db.execute("UPDATE applications SET status='applied' WHERE job_id=5")
            db.execute('CREATE TABLE IF NOT EXISTS scores (job_id INTEGER, scorer_version TEXT, input_hash TEXT, model TEXT, created_at TEXT, data_json TEXT)')   # made by src/ai in the app
            for job_id in (1, 3):
                db.execute("INSERT INTO scores (job_id, scorer_version, input_hash, model, created_at, data_json) VALUES (?, 'v', 'h', 'm', 'now', '{}')", (job_id,))
            self.assertEqual(store.prune_gone(db, now=now), 2)
            left = sorted(row[0] for row in db.execute('SELECT id FROM jobs'))
            scores = sorted(row[0] for row in db.execute('SELECT job_id FROM scores'))
            orphans = db.execute('SELECT COUNT(*) FROM applications WHERE job_id NOT IN (SELECT id FROM jobs)').fetchone()[0]
        self.assertEqual(left, [3, 4, 5])
        self.assertEqual(scores, [3])
        self.assertEqual(orphans, 0)


if __name__ == '__main__':
    unittest.main()
