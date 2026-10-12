"""The lock tests wait on the lock's own state, never on a count of files or a guessed nap (12 Oct 2026: the required python check went red 5+ times on PRs that never touched the lock).
Guards every test of the family (heavy lock, landing queue, check slot, red main landings): no file counting, every nap says why it is not an order wait (`# clock:`),
and the helper's reading of the books (tests/heavy_wait.py): a slot still being written names no run, a run's slot plus its own ticket is one run, a run that ended fails at once with the evidence."""
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.heavy_wait import registered, wait_in_books, where

TESTS = Path(__file__).resolve().parent
FAMILY = sorted({*TESTS.glob('test_heavy_lock*.py'), *(TESTS / n for n in ('test_red_fix_first.py', 'test_landing_lock.py', 'test_check_slot.py', 'test_revert_red.py',
                                                                           'test_ship_red.py', 'heavy_wait.py', 'heavy_lock_fixture.py'))})


class LockTestWaits(unittest.TestCase):
    def test_no_test_of_the_family_counts_files_or_naps_without_saying_why(self):
        bad = []
        for path in FAMILY:
            for n, line in enumerate(path.read_text().splitlines(), 1):
                if re.search(r'\bwait_registered\(|glob\([\'"]lock\*[\'"]\)\)\)? *<', line):
                    bad.append(f'{path.name}:{n}: counts files instead of waiting for one run by its pid (heavy_wait.wait_in_books)')
                if re.search(r'\btime\.sleep\(', line) and '# clock:' not in line:
                    bad.append(f'{path.name}:{n}: a nap without "# clock: <why no order depends on it>"; wait on the lock\'s state instead')
        self.assertEqual(bad, [])

    def test_the_family_is_found(self):
        self.assertGreaterEqual(len([p for p in FAMILY if p.exists()]), 18, [p.name for p in FAMILY])

    def test_a_slot_still_being_written_names_no_run_and_a_slot_plus_its_own_ticket_is_one(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'lock').mkdir()                       # mkdir done, pid not written yet
            (root / 'queue').mkdir()
            (root / 'queue' / '1-111').write_text('111 e2e-smoke\n\n')
            self.assertEqual(registered(d), 1, 'the half-made slot is no run')
            (root / 'lock' / 'pid').write_text('111\n')   # run 111 took the slot and still has its ticket for a moment
            self.assertEqual(registered(d), 1, 'one run, not two')
            self.assertEqual(where(d, 111), 'holds')
            (root / 'queue' / '2-222').write_text('222 row\nloadwait\n')
            self.assertEqual((where(d, 222), where(d, 333)), ('loadwait', None))

    def test_a_run_that_ended_before_it_queued_fails_at_once_with_its_exit_code_and_stderr(self):
        with tempfile.TemporaryDirectory() as d:
            proc = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stderr.write("boom\\n"); sys.exit(7)'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            with self.assertRaises(AssertionError) as caught:
                wait_in_books(d, proc, timeout=60)
            text = str(caught.exception)
            self.assertIn('and it ended', text)
            self.assertIn('exit 7', text)
            self.assertIn('boom', text)
            self.assertIn('books: empty', text)


if __name__ == '__main__':
    unittest.main()
