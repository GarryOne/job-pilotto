"""Candidate postings shared with the pool (src/contribute_candidates.py): only the address, host and source leave, never a title, company, note or stage."""
import json
import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import contribute, contribute_candidates  # noqa: E402

SECRET_TITLE, SECRET_COMPANY, SECRET_NOTE = 'Head of Secret Plans', 'Hidden Employer AG', 'my private note: call back Tuesday'


def store(rows):
    """A job store with the columns that carry personal data filled in (title, company, location, note, score): none of it may leave."""
    db = sqlite3.connect(':memory:')
    db.executescript("""CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT, url TEXT, kind TEXT);
        CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE jobs (id INTEGER PRIMARY KEY, source_id INTEGER, company_id INTEGER, title TEXT, url TEXT, location TEXT, city TEXT, state TEXT,
                           first_seen_at TEXT, notes TEXT, confidence REAL, salary_json TEXT);
        INSERT INTO sources VALUES (1, 'Feed', 'x', 'employer feed'), (2, 'Board', 'y', 'job board');
        INSERT INTO companies VALUES (1, 'Hidden Employer AG');""")
    for n, (url, source, state) in enumerate(rows):
        db.execute('INSERT INTO jobs VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0.93, ?)', (n, source, SECRET_TITLE, url, 'Zurich, home address 4 Elm St', 'Zurich', state,
                                                                                  f'2026-10-{10 + n % 7:02d}T00:00:00+00:00', SECRET_NOTE, '{"min": 120000}'))
    return db


class CandidatesTest(unittest.TestCase):
    def test_only_url_host_and_source_leave_whatever_the_store_holds(self):
        db = store([('https://careers.example.com/jobs/101', 1, 'open'), ('https://boards.example.org/p/9', 1, 'open')])
        out = contribute_candidates.candidates(db)
        self.assertEqual(len(out), 2)
        for item in out:
            self.assertEqual(set(item), {'url', 'host', 'source'})
        text = json.dumps(out)
        for private in (SECRET_TITLE, SECRET_COMPANY, SECRET_NOTE, 'Zurich', 'Elm', '120000', '0.93'):
            self.assertNotIn(private, text)

    def test_the_whole_contribution_body_carries_no_personal_field_either(self):
        db = store([('https://careers.example.com/jobs/101', 1, 'open')])
        body = contribute.payload([], {}, install='abc-12345678', db=db, stages={'https://careers.example.com/jobs/101': 'Applying'})
        self.assertEqual(body['candidates'], [{'url': 'https://careers.example.com/jobs/101', 'host': 'careers.example.com', 'source': 'applying'}])
        text = json.dumps(body)
        for private in (SECRET_TITLE, SECRET_COMPANY, SECRET_NOTE, 'Zurich', 'Elm', '120000', 'Applying'):
            self.assertNotIn(private, text)

    def test_boards_closed_jobs_and_addresses_with_a_query_or_fragment_are_left_out(self):
        db = store([('https://jobs.board.test/p/1', 2, 'open'), ('https://careers.example.com/closed', 1, 'closed'), ('https://careers.example.com/j?id=4&q=geneva', 1, 'open'),
                    ('https://careers.example.com/j#top', 1, 'open'), ('http://careers.example.com/plain', 1, 'open'), ('https://user:pw@careers.example.com/x', 1, 'open'),
                    ('https://localhost/x', 1, 'open'), ('https://e2e-employer.example.com/x', 1, 'open'), ('https://careers.example.com/ok', 1, 'open')])
        self.assertEqual([item['url'] for item in contribute_candidates.candidates(db)], ['https://careers.example.com/ok'])

    def test_started_applications_come_first_a_host_gives_three_and_the_list_stops_at_forty(self):
        rows = [(f'https://many.example.com/j/{n}', 1, 'open') for n in range(10)] + [(f'https://h{n}.example.com/j/1', 1, 'open') for n in range(60)]
        out = contribute_candidates.candidates(store(rows), {'https://h7.example.com/j/1': 'Applying', 'https://h8.example.com/j/1': 'Applied'})
        self.assertEqual(out[0]['source'], 'applying')
        self.assertEqual(out[0]['host'], 'h7.example.com')
        self.assertEqual([item['source'] for item in out].count('applying'), 1, 'an applied job is not "stuck"')
        self.assertEqual(len(out), 40)
        self.assertEqual(sum(item['host'] == 'many.example.com' for item in out), 3)

    def test_no_database_no_candidates_and_the_daily_refresh_resends_them(self):
        self.assertEqual(contribute_candidates.candidates(None), [])
        self.assertEqual(contribute_candidates.candidates(sqlite3.connect(':memory:')), [])
        body = {'install': 'x', 'feeds': [], 'candidates': [{'url': 'https://a.example.com/j/1', 'host': 'a.example.com', 'source': 'matches'}]}
        db = sqlite3.connect(':memory:')
        kept, marks = contribute.only_changed(db, body)
        self.assertEqual(len(kept['candidates']), 1)
        contribute.mark_sent(db, marks)
        self.assertNotIn('candidates', contribute.only_changed(db, body)[0], 'unchanged within 20 hours: not sent twice')


if __name__ == '__main__':
    unittest.main()
