"""The daily random draw (tools/persona-search/draw.py, owner 18 Oct 2026): the same seed gives the same draw and CV, the lists are the agreed size and unique, the CV is fictional."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' / 'persona-search'))
import draw  # noqa: E402


class DrawTest(unittest.TestCase):
    def test_lists_are_the_agreed_size_and_unique(self):
        self.assertGreaterEqual(len(draw.DATA['families']), 20)
        self.assertGreaterEqual(len(draw.DATA['cities']), 40)
        for key, rows in (('id', draw.DATA['families']), ('city', draw.DATA['cities'])):
            names = [row[key] for row in rows]
            self.assertEqual(len(names), len(set(names)), key)

    def test_same_seed_same_draw_and_cv(self):
        with tempfile.TemporaryDirectory() as one, tempfile.TemporaryDirectory() as two:
            first, second = draw.write('2026-10-18', one), draw.write('2026-10-18', two)
            self.assertEqual(first, second)
            self.assertEqual((Path(one) / 'draw' / 'cv.pdf').read_bytes(), (Path(two) / 'draw' / 'cv.pdf').read_bytes())
            self.assertEqual(json.loads((Path(one) / 'draw' / 'draw.json').read_text())['seed'], '2026-10-18')

    def test_a_month_of_seeds_varies(self):
        picks = {draw.pick(f'2026-10-{day:02d}')[0]['id'] + draw.pick(f'2026-10-{day:02d}')[1]['city'] for day in range(1, 29)}
        self.assertGreater(len(picks), 20)

    def test_cv_is_fictional(self):
        for day in range(1, 29):
            family, city, name = draw.pick(f'2026-11-{day:02d}')
            text = '\n'.join(draw.cv(family, city, name))
            self.assertIn('@example.test', text)
            self.assertIn(city['city'], text)
            self.assertNotIn('linkedin', text.lower())


if __name__ == '__main__':
    unittest.main()
