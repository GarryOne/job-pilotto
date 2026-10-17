"""The PR replay check's name says how many rows it replays of how many are pinned, and stays true when a pin adds or removes a row."""
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
        named = re.search(r'^name: CI · Site replays · PR \((\d+) of (\d+) pinned rows\)$', text, re.M)
        self.assertIsNotNone(named, 'site-replays-pr.yml: name it "CI · Site replays · PR (<k> of <n> pinned rows)"')
        self.assertEqual(int(named.group(2)), pinned, f'site-replays-pr.yml: the name says {named.group(2)} pinned rows, replay-faithful.json pins {pinned}: update the name in the same PR')
        self.assertLessEqual(int(named.group(1)), int(named.group(2)), 'the PR replays at most the pinned rows (k of n)')
        # k is one row per kind of form, the PR_KINDS list (7): desktop/e2e/test/replay-pick.test.mjs computes it and fails when the name's k is stale.


if __name__ == '__main__':
    unittest.main()
