"""Outbound or inbound: the Python rule gives the answers of the shared table (the desktop app's rule is checked
against the same table in desktop/test/origin.test.js)."""
import json
import unittest
from pathlib import Path

from src.notion.origin import is_inbound, origin

TABLE = json.loads((Path(__file__).parent / 'fixtures' / 'opportunity_origin.json').read_text())


class OriginTest(unittest.TestCase):
    def test_shared_table(self):
        self.assertGreaterEqual(len(TABLE['cases']), 10)
        for case in TABLE['cases']:
            with self.subTest(case['name']):
                self.assertEqual(origin(**case['row']), case['origin'])

    def test_empty_and_none(self):
        self.assertEqual(origin(), 'outbound')
        self.assertEqual(origin(source=None, stage=None, notes=None, kinds=None), 'outbound')
        self.assertTrue(is_inbound(source='LinkedIn'))


if __name__ == '__main__':
    unittest.main()
