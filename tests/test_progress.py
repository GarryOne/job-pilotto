"""Long steps say where they are (src/progress.py): at the start, at most every few seconds, and at the end."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.progress import Ticker  # noqa: E402


class TickerTest(unittest.TestCase):
    def test_start_then_paced_then_end(self):
        said, now = [], [0.0]
        ticker = Ticker('Reading new jobs with AI', 26, every=8, clock=lambda: now[0], out=said.append)
        for done, at in ((1, 1), (2, 5), (3, 9), (4, 12), (26, 13)):
            now[0] = at
            ticker.tick(done)
        self.assertEqual(said, ['⏳ Reading new jobs with AI: 0 of 26', '⏳ Reading new jobs with AI: 3 of 26', '⏳ Reading new jobs with AI: 26 of 26'])

    def test_extra_words_and_nothing_for_an_empty_step(self):
        said = []
        Ticker('Reading employer job sites', 202, out=said.append).tick(202, ' · 3,412 jobs listed')
        self.assertEqual(said[-1], '⏳ Reading employer job sites: 202 of 202 · 3,412 jobs listed')
        quiet = []
        Ticker('Scoring jobs against your Profile', 0, out=quiet.append).tick(0)
        self.assertEqual(quiet, [])


if __name__ == '__main__':
    unittest.main()
