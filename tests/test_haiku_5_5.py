"""Haiku 5.5 (8 Oct 2026): it thinks by default and the thinking counts towards max_tokens, so every Haiku call runs at low
effort and leaves room to think. Haiku 4.5 still gets no effort (it rejects one with a 400)."""
import re
import unittest
from pathlib import Path

from src.ai import engine

ROOT = Path(__file__).resolve().parent.parent


class EffortGate(unittest.TestCase):
    def test_haiku_5_5_runs_at_low_and_haiku_4_5_sends_none(self):
        self.assertEqual(engine.effort_for('claude-haiku-5-5', 'medium'), 'low')
        self.assertEqual(engine.effort_for('claude-haiku-5-5', None), 'low')
        self.assertIsNone(engine.effort_for('claude-haiku-4-5', 'medium'))
        self.assertEqual(engine.effort_for('claude-sonnet-5-5', 'medium'), 'medium')
        self.assertIsNone(engine.effort_for('claude-sonnet-5-5', None))
        self.assertEqual(engine.structured({'a': 1}, 'claude-haiku-5-5', 'high')['effort'], 'low')


class EveryHaikuCall(unittest.TestCase):
    """The class, not the case: any engine file that names Haiku 5.5."""

    def files(self):
        found = [p for p in (ROOT / 'src').rglob('*.py') if 'claude-haiku-5-5' in p.read_text()]
        self.assertGreater(len(found), 10)   # the scan itself found the Haiku callers
        return found

    def test_room_to_think(self):
        for path in self.files():
            for n in re.findall(r'max_tokens=(\d+)', path.read_text()):
                self.assertGreaterEqual(int(n), 1000, f'{path.relative_to(ROOT)}: max_tokens={n} leaves Haiku 5.5 no room to think')

    def test_effort_goes_through_the_gate(self):
        for path in self.files():
            self.assertNotIn("startswith('claude-haiku')", path.read_text(), f'{path.relative_to(ROOT)}: use engine.effort_for')
            self.assertNotRegex(path.read_text(), r"output_config=\{'format'", f'{path.relative_to(ROOT)}: use engine.structured')


if __name__ == '__main__':
    unittest.main()
