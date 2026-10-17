"""Yield per source (src/source_yield.py): which employer feeds and job boards gave a search its relevant jobs, kept per run and said in one line.
18 Oct 2026, persona runs: a board kept "jobs: 34" whether they were 30 real Nuremberg driver jobs or its own banner, and every board's jobs counted
as one source "Job boards found"; nothing could keep or drop a source by what it gave (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md)."""
import json
import tempfile
import unittest
from pathlib import Path

from src import source_yield, store

RUN = '2026-10-18T10:00:00+00:00'
EARLIER = '2026-10-17T10:00:00+00:00'


class SourceYieldTests(unittest.TestCase):
    def _db(self, tmp):
        db = store.connect(Path(tmp) / 'jobs.sqlite')
        db.execute("INSERT INTO companies (id, name, updated_at) VALUES (1, 'X', ?)", (EARLIER,))
        db.executemany('INSERT INTO sources (id, name, kind) VALUES (?, ?, ?)',
                       [(1, 'Kuehne + Nagel', 'employer feed'), (2, 'Job boards found', 'job board'), (3, 'Arbeitnow', 'job board')])
        jobs = [  # id, source, title, url, location, first seen, state
            (1, 1, 'Lagermitarbeiter', 'https://careers.example-kn.test/job/1', 'Nürnberg', EARLIER, 'open'),
            (2, 1, 'Teamleiter', 'https://careers.example-kn.test/job/2', 'Hamburg', RUN, 'open'),
            (3, 2, 'LKW Fahrer CE', 'https://www.board-one.test/jobs/3', 'Nürnberg', RUN, 'open'),
            (4, 2, 'Berufskraftfahrer', 'https://jobs.board-one.test/jobs/4', 'Fürth', RUN, 'open'),
            (5, 2, 'Kraftfahrer', 'https://www.board-two.test/a/5', 'Nürnberg', RUN, 'open'),
            (6, 3, 'Fahrer', 'https://www.arbeitnow-like.test/6', 'Nürnberg', RUN, 'unmatched'),
        ]
        for job_id, source, title, url, where, seen, state in jobs:
            db.execute('INSERT INTO jobs (id, canonical_key, source_id, company_id, title, url, location, first_seen_at, last_seen_at, state) '
                       'VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)', (job_id, f'k{job_id}', source, title, url, where, seen, seen, state))
        db.execute('CREATE TABLE scores (job_id INTEGER PRIMARY KEY, scorer_version INTEGER NOT NULL, input_hash TEXT NOT NULL, model TEXT, '
                   'created_at TEXT, data_json TEXT)')
        for job_id, fit in [(1, 40), (3, 82), (4, 70)]:
            db.execute("INSERT INTO scores VALUES (?, 1, 'h', 'm', ?, ?)", (job_id, RUN, json.dumps({'score': fit})))
        return db

    @staticmethod
    def _in_places(job):
        return job['location'] in ('Nürnberg', 'Fürth')

    def test_each_board_host_is_its_own_source_and_counts_are_per_source(self):
        with tempfile.TemporaryDirectory() as tmp, self._db(tmp) as db:
            rows = {row['source']: row for row in source_yield.measure(db, RUN, in_places=self._in_places)}
        self.assertEqual(set(rows), {'Kuehne + Nagel', 'board-one.test', 'board-two.test'}, 'boards by host; an unmatched job counts nowhere')
        self.assertEqual({k: rows['board-one.test'][k] for k in ('kind', 'open', 'in_places', 'new', 'scored', 'fit70')},
                         {'kind': 'job board', 'open': 2, 'in_places': 2, 'new': 2, 'scored': 2, 'fit70': 2})
        self.assertEqual({k: rows['Kuehne + Nagel'][k] for k in ('kind', 'open', 'in_places', 'new', 'scored', 'fit70')},
                         {'kind': 'employer feed', 'open': 2, 'in_places': 1, 'new': 0, 'scored': 1, 'fit70': 0})
        self.assertEqual(rows['board-two.test']['scored'], 0)

    def test_best_sources_first_and_kept_per_run(self):
        with tempfile.TemporaryDirectory() as tmp, self._db(tmp) as db:
            rows = source_yield.measure(db, RUN, in_places=self._in_places)
            self.assertEqual([row['source'] for row in rows], ['board-one.test', 'Kuehne + Nagel', 'board-two.test'],
                             'fit >= 70 first, then jobs in your places, then open jobs')
            source_yield.record(db, RUN, rows)
            source_yield.record(db, EARLIER, rows[:1])
            latest = source_yield.latest(db)
        self.assertEqual(len(latest), 3, 'the last run only')
        self.assertTrue(all(row['run_at'] == RUN for row in latest))

    def test_the_line_names_the_sources_and_says_when_none_gave_a_job(self):
        with tempfile.TemporaryDirectory() as tmp, self._db(tmp) as db:
            line = source_yield.line(source_yield.measure(db, RUN, in_places=self._in_places), limit=2)
        self.assertTrue(line.startswith('Where your jobs came from: board-one.test (job board) 2 in your places, 2 fit 70+'), line)
        self.assertIn('and 1 more source', line)
        self.assertEqual(source_yield.line([]), 'Where your jobs came from: no source gave a job in your places yet')

    def test_a_cache_without_scores_still_counts(self):
        with tempfile.TemporaryDirectory() as tmp, self._db(tmp) as db:
            db.execute('DROP TABLE scores')
            rows = source_yield.measure(db, RUN, in_places=self._in_places)
        self.assertEqual(sum(row['scored'] for row in rows), 0)
        self.assertEqual(sum(row['in_places'] for row in rows), 4)


if __name__ == '__main__':
    unittest.main()
