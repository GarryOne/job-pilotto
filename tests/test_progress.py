"""Long steps say where they are (src/progress.py): at the start, at most every few seconds, and at the end."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.progress import Ticker, left  # noqa: E402


class TickerTest(unittest.TestCase):
    def test_start_then_paced_then_end(self):
        said, now = [], [0.0]
        ticker = Ticker('Reading new jobs with AI', 26, every=8, clock=lambda: now[0], out=said.append)
        for done, at in ((1, 1), (2, 5), (3, 9), (4, 12), (26, 13)):
            now[0] = at
            ticker.tick(done)
        self.assertEqual(said, ['⏳ Reading new jobs with AI: 0 of 26', '⏳ Reading new jobs with AI: 3 of 26 · about 1 min left', '⏳ Reading new jobs with AI: 26 of 26'])

    def test_extra_words_and_nothing_for_an_empty_step(self):
        said = []
        Ticker('Reading employer job sites', 202, out=said.append).tick(202, ' · 3,412 jobs listed')
        self.assertEqual(said[-1], '⏳ Reading employer job sites: 202 of 202 · 3,412 jobs listed')
        quiet = []
        Ticker('Scoring jobs against your Profile', 0, out=quiet.append).tick(0)
        self.assertEqual(quiet, [])

    def test_time_left_from_the_pace_so_far(self):
        self.assertEqual(left(120, 1, 6), ' · about 10 min left')    # 2 min a batch, 5 to go
        self.assertEqual(left(150, 5, 6), ' · under a minute left')
        self.assertEqual(left(5, 5, 6), '')                          # a few seconds: not worth saying
        self.assertEqual((left(0, 0, 6), left(300, 6, 6)), ('', ''))  # nothing done yet, and the end


if __name__ == '__main__':
    unittest.main()
