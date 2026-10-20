"""Steps skipped thanks to the pool (src/pool_served.py): a fixed-shape count per kind rides along in the daily share; nothing else about the steps."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import contribute, pool_served  # noqa: E402


class PoolServedTest(unittest.TestCase):
    def setUp(self):
        self.patch = mock.patch.object(pool_served, 'STORE', Path(tempfile.mkdtemp()) / 'served.json')
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_counts_add_up_per_kind_and_a_bad_kind_is_ignored(self):
        pool_served.count('places')
        pool_served.count('places', 2)
        pool_served.count('Not A Kind')
        pool_served.count('x' * 40)
        self.assertEqual(pool_served.load(), {'places': 3})

    def test_the_share_carries_the_counts_and_nothing_when_there_are_none(self):
        self.assertNotIn('served', contribute.payload([], {}, install='abc-12345678'))
        pool_served.count('places', 4)
        self.assertEqual(contribute.payload([], {}, install='abc-12345678')['served'], {'places': 4})

    def test_the_counts_survive_the_send_filter(self):
        pool_served.count('places', 4)
        body, _marks = contribute.only_changed(None, contribute.payload([], {}, install='abc-12345678'))
        self.assertEqual(body['served'], {'places': 4})


if __name__ == '__main__':
    unittest.main()
