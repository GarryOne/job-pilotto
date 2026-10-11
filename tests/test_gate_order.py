"""The push gate runs its seconds-long commit-message checks before the minutes-long journey and ladder gates, so a missing trailer fails fast."""
# 11 Oct 2026: a missing "Rung:" line was reported only after a 255 s journey gate, three times in one landing.
import unittest
from pathlib import Path

GATE = (Path(__file__).resolve().parent.parent / 'tools' / 'pre-push-check.sh').read_text()


class GateOrderTest(unittest.TestCase):
    def test_cheap_checks_run_before_the_slow_gates(self):
        slow = min(GATE.index('timed "journey gate"'), GATE.index('timed "ladder gate"'))
        for cheap in ('timed "file size"', 'timed "recorded cases"', 'timed "rung trailer"', 'timed "e2e issue links"'):
            self.assertLess(GATE.index(cheap), slow, f'{cheap} must run before the journey and ladder gates')


if __name__ == '__main__':
    unittest.main()
