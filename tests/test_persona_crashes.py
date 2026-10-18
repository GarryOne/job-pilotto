"""The persona search check reports a crashed step as FAILED, never as a thin clean run (tools/persona-search/crashes.py, run.mjs)."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import crashes  # noqa: E402

LOG = """[10s] ⏳ Reading employer job sites: 5 of 9 · 100 jobs listed
[126s] ⏳ Reading job boards: 0 of 3
[126s] Traceback (most recent call last):
[126s]   File "found_boards.py", line 57, in read_board
[126s]     page = fetch(url)
[126s]            ^^^^^^^^^^
[126s] AttributeError: 'dict' object has no attribute 'get_content_charset'
[126s] Searching job boards…
"""


class CrashesTest(unittest.TestCase):
    def test_a_traceback_names_its_step_and_error(self):
        self.assertEqual(crashes.find(LOG), [{'step': 'Reading job boards', 'error': "AttributeError: 'dict' object has no attribute 'get_content_charset'"}])

    def test_a_clean_log_has_none(self):
        self.assertEqual(crashes.find('[1s] Finding your first jobs…\n[2s] Job boards found: X 3 job(s), 1 relevant\n'), [])

    def test_the_harness_fails_the_run_on_a_crash(self):
        """The class: every press row carries its crashes, and a crash ends the run as FAILED (exit code 1), whatever the numbers."""
        run = (ROOT / 'tools' / 'persona-search' / 'run.mjs').read_text()
        self.assertIn("'crashes.py'", run)
        self.assertIn('PERSONA FAILED', run)
        self.assertIn('process.exitCode = 1', run)


if __name__ == '__main__':
    unittest.main()
