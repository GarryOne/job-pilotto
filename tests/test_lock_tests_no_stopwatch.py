"""The lock's own tests never decide by a stopwatch: "it took under N seconds" fails on a loaded runner (2.4 s against a limit of 2, beta run 38190180434, 12 Oct 2026).
They assert what the lock says it did (no 'waits' / 'waited' / 'got the lock after' in its log) or wait until a state is reached."""
import re
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
STOPWATCH = re.compile(r'assertLess(?:Equal)?\(\s*time\.(?:monotonic|time)\(\)\s*-')


class LockTestsNoStopwatchTest(unittest.TestCase):
    def test_no_lock_test_asserts_an_elapsed_time_upper_bound(self):
        files = sorted(TESTS.glob('test_heavy_lock*.py')) + [TESTS / 'test_red_fix_first.py']
        self.assertGreaterEqual(len(files), 3, 'the lock test files are still found')
        found = [f'{file.name}:{number}' for file in files for number, line in enumerate(file.read_text().splitlines(), 1) if STOPWATCH.search(line)]
        self.assertEqual(found, [], 'an elapsed-time upper bound in a lock test: assert the lock\'s log instead (no waits/waited/got the lock after)')

    def test_the_pattern_matches_the_old_form(self):   # the positive control: the guard would have caught the line that failed
        self.assertTrue(STOPWATCH.search("        self.assertLess(time.monotonic() - began, 2, 'a dead waiter holds nobody up')"))
        self.assertTrue(STOPWATCH.search("        self.assertLess(time.time() - began, 5, 'x')"))
        self.assertFalse(STOPWATCH.search("        self.assertGreaterEqual(time.monotonic() - began, 1.5, 'not freed before the idle limit')"))


if __name__ == '__main__':
    unittest.main()
