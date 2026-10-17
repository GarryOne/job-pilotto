import io
import unittest
from contextlib import redirect_stdout

from src import run_counts


class RunCountsTests(unittest.TestCase):
    def setUp(self):
        run_counts.reset()

    def test_a_job_seen_on_two_sources_counts_once(self):
        out = io.StringIO()
        with redirect_stdout(out):
            run_counts.looked([{'url': 'https://a/1'}, {'url': 'https://a/2'}])
            run_counts.looked([{'url': 'https://a/2'}, {'url': 'https://b/3'}])
            run_counts.matched([{'url': 'https://a/1'}])
            run_counts.matched([{'url': 'https://a/1'}])
            run_counts.scored({'url': 'https://a/1'})
        self.assertEqual(run_counts.line(), 'Run counts: looked=3 matches=1 scored=1')
        self.assertEqual(out.getvalue().strip().splitlines()[-1], 'Run counts: looked=3 matches=1 scored=1')
        self.assertEqual(out.getvalue().count('Run counts:'), 4, 'a repeat prints nothing')

    def test_a_match_was_looked_at(self):
        with redirect_stdout(io.StringIO()):
            run_counts.matched([{'url': 'https://x/9'}])
        self.assertEqual(run_counts.line(), 'Run counts: looked=1 matches=1 scored=0')
