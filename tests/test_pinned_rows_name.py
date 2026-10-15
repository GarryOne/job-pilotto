"""The PR replay check's name says how many rows are pinned, and stays true when a pin adds or removes a row."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class PinnedRowsName(unittest.TestCase):
    def test_the_name_counts_the_pinned_rows(self):
        data = json.loads((ROOT / 'desktop' / 'e2e' / 'replay-faithful.json').read_text())
        # Pinned = held on a CI runner, macOS or Linux (desktop/e2e/lib/replay-ratchet.mjs `pinned`); the Mac place is a record, not held.
        pinned = sum(1 for row in data.get('rows', {}).values() if row.get('runner') is True or row.get('linux') is True)
        text = (ROOT / '.github' / 'workflows' / 'site-replays-pr.yml').read_text()
        named = re.search(r'^name: CI · Site replays · PR \((\d+) pinned rows\)$', text, re.M)
        self.assertIsNotNone(named, 'site-replays-pr.yml: name it "CI · Site replays · PR (<n> pinned rows)"')
        self.assertEqual(int(named.group(1)), pinned, f'site-replays-pr.yml: the name says {named.group(1)} pinned rows, replay-faithful.json pins {pinned}: update the name in the same PR')


if __name__ == '__main__':
    unittest.main()
