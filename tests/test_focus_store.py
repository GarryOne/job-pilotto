"""Focus on the store on this Mac (src/focus.py load): its reads run in turn, since a sqlite connection refuses another thread, while a
store reached over the network (Notion, caps CLOUD) still reads side by side. 9 Oct 2026: Focus and Reports → Funnel failed on SQLite."""
import tempfile
import threading
import unittest
from datetime import datetime, timezone

from src import focus
from src.stores import base, open_stores


class FocusOnTheStoreTests(unittest.TestCase):
    def test_focus_reads_a_sqlite_store_with_its_funnel(self):
        with tempfile.TemporaryDirectory() as tmp:
            stores = open_stores({'JOB_PILOTTO_STORE': 'sqlite', 'JOB_PILOTTO_DATA_DIR': tmp})
            self.assertNotIn(base.CLOUD, stores.caps)
            stores.applications.create({'url': 'https://jobs.test/a', 'title': 'SRE', 'company': 'Acme', 'applied_on': '2026-10-08'}, 'Applied')
            stores.applications.create({'url': 'https://jobs.test/b', 'title': 'SRE', 'company': 'Beta'}, 'Kit ready')
            result = focus.load(stores, target=5, now=datetime(2026, 10, 9, tzinfo=timezone.utc), gmail=False)
        steps = {step['step']: step['reached'] for step in result['funnel']['steps']}
        self.assertEqual(steps['📨 Applied'], 1)
        self.assertTrue(result['funnel']['summary'])

    def test_a_networked_store_still_reads_side_by_side(self):
        threads = set()
        class Entity:   # every read notes the thread it ran on
            def list(self, **_):
                threads.add(threading.get_ident())
                return []
        stores = base.Stores(name='fake', applications=Entity(), events=Entity(), matches=Entity(), interviews=Entity(), insights=Entity(),
                             employers=Entity(), agent_runs=Entity(), cron_runs=Entity(), texts=Entity(), caps=frozenset({base.CLOUD}))
        focus.load(stores, target=5, now=datetime(2026, 10, 9, tzinfo=timezone.utc), gmail=False)
        self.assertNotIn(threading.get_ident(), threads)


if __name__ == '__main__':
    unittest.main()
