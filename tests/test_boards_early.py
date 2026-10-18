"""Job boards read early (owner, 19 Oct 2026: music's only paying board, XING, was 7th of the proposal and its jobs came at 351 s): the
first-jobs slice reads 6 boards at once and replaces each one that refuses automated reading by the next proposed one (src/first_jobs.py);
the full search reads the found boards beside the employer sites, not after them, and shows their jobs as soon as they are read
(src/sources/boards_ahead.py), and the board scan takes them instead of reading again (src/sources/aggregators.py)."""
import sqlite3
import threading
import unittest
from unittest import mock

from src import first_jobs
from src.ai import board_ideas
from src.sources import aggregators, board_yield, boards_ahead, found_boards
from src.sources import careers

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

SEARCH = {'role_keywords': ['tontechniker'], 'locations': {'top_tier': ['berlin'], 'country_wide': [], 'abroad': []}}


def board(n):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Germany'],
            'kinds': ['any'], 'source_kind': 'general'}


class SliceTests(unittest.TestCase):
    def slice(self, refusing):
        """The slice's board reads, as [(hosts, workers, remember)], with `refusing` hosts marked 'browser' by their read."""
        data, reads, said = {'boards': {}}, [], []

        def read(search, boards, early=False, workers=found_boards.BOARD_WORKERS, remember=True):
            reads.append(([b['host'] for b in boards], workers, remember))
            for b in boards:
                data['boards'][b['host']] = {'state': 'browser' if b['host'] in refusing else 'ok'}
            return [{'title': 'Tontechniker', 'host': b['host']} for b in boards if b['host'] not in refusing]
        with mock.patch.object(board_ideas, 'proven', return_value=[]), mock.patch.object(board_ideas, 'ideas', return_value=[board(n) for n in range(1, 10)]), \
                mock.patch.object(board_ideas, 'load', return_value=data), mock.patch.object(found_boards, 'read', read):
            jobs = first_jobs.board_jobs(said.append, SEARCH)
        return reads, jobs, said

    def test_six_boards_are_read_at_once(self):
        self.assertLessEqual(first_jobs.SLICE_BOARDS, board_yield.MAX_UNTRIED, 'one read takes this many untried boards')
        reads, jobs, _ = self.slice(refusing=set())
        self.assertEqual(reads, [([f'b{n}.example' for n in range(1, 7)], 6, True)], 'no refusal: one read')
        self.assertEqual(len(jobs), 6)

    def test_a_board_that_refuses_is_replaced_by_the_next_proposed_one(self):
        reads, jobs, said = self.slice(refusing={'b1.example', 'b3.example', 'b5.example', 'b6.example'})
        self.assertEqual(reads[1], (['b7.example', 'b8.example', 'b9.example'], 6, False), 'the next ones, these only (no board read twice)')
        self.assertEqual(sorted(job['host'] for job in jobs), ['b2.example', 'b4.example', 'b7.example', 'b8.example', 'b9.example'])
        self.assertTrue(any('refused automated reading; reading Board 7, Board 8, Board 9 instead' in line for line in said), said)

    def test_a_second_wave_reads_the_given_boards_only(self):
        kept = {'paid.example': {'state': 'ok', 'relevant': 4, 'search_url': 'https://paid.example/?q={role}', 'countries': ['Germany'],
                                 'last_read': '2026-10-18'}}
        self.assertIn('paid.example', [b['host'] for b in board_yield.pick([board(7)], kept)])
        self.assertEqual([b['host'] for b in board_yield.pick([board(7)], kept, remember=False)], ['b7.example'])


class SoFar:
    def __init__(self):
        self.seen = []

    def listener(self, where):
        return lambda jobs: self.seen.append((where, [job['title'] for job in jobs]))


class BesideTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.board_reads = 0
        self.board_read = threading.Event()

        def read(search):
            self.board_reads += 1
            self.board_read.set()
            return [{'title': 'Tontechniker'}]
        for patch in (mock.patch.object(aggregators, 'sources', lambda env=None: [(boards_ahead.NAME, read)]),
                      mock.patch.object(aggregators, 'kept', lambda db, name, found, now=None: list(found))):
            patch.start()
            self.addCleanup(patch.stop)

    def scan(self, sources, db, on_jobs=None):   # employer sites: the boards' read ends while they are still being read
        on_jobs([{'title': 'Site job 1'}])
        self.assertTrue(self.board_read.wait(5), 'the boards are read while the employer sites are')
        if self.ahead_box:
            self.ahead_box.wait()
        on_jobs([{'title': 'Site job 2'}])
        self.so_far.seen.append(('employer sites ended', []))
        return {'jobs': [], 'sources': []}

    def test_the_boards_jobs_are_shown_during_the_employer_sites_read_and_not_read_again(self):
        so_far = self.so_far = SoFar()
        self.ahead_box = None
        real_start = boards_ahead.start

        def start(db, search, env=None, now=None):
            self.ahead_box = real_start(db, search, env, now)
            return self.ahead_box
        with mock.patch.object(boards_ahead, 'start', start):
            report, ahead = boards_ahead.scan_beside([], self.db, SEARCH, so_far, due=True, scan=self.scan)
        where = [entry[0] for entry in so_far.seen]
        self.assertLess(where.index('job boards'), where.index('employer sites ended'), 'shown in the list before the employer sites end')
        self.assertEqual(where.count('job boards'), 1)
        shown = []
        found = aggregators.scan(self.db, SEARCH, on_jobs=shown.append, ahead=ahead)
        self.assertEqual(self.board_reads, 1, 'taken, not read again')
        self.assertEqual([job['title'] for job in found['jobs']], ['Tontechniker'])
        self.assertEqual(shown, [], 'shown once')

    def test_a_search_that_reads_no_boards_starts_none(self):
        report, ahead = boards_ahead.scan_beside([], self.db, SEARCH, SoFar(), due=False, scan=lambda sources, db, on_jobs=None: {'jobs': []})
        self.assertIsNone(ahead)
        self.assertEqual(self.board_reads, 0)

    def test_boards_read_in_the_last_hours_are_not_read_again(self):
        self.db.execute(aggregators.TABLE)
        from datetime import datetime, timezone
        self.db.execute('INSERT INTO aggregator_runs VALUES (?, ?)', (boards_ahead.NAME, datetime.now(timezone.utc).isoformat()))
        self.assertIsNone(boards_ahead.start(self.db, SEARCH))
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': '/x'}):
            self.assertIsNone(boards_ahead.start(sqlite3.connect(':memory:'), SEARCH), 'the fixture mode never reaches a live site')


if __name__ == '__main__':
    unittest.main()
