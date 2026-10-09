"""The memory adapter passes the store contract, and open_stores picks adapters by the documented rule."""
import unittest

from src import stores
from src.stores import memory
from tests.store_contract import StoreContract


class MemoryStoreTests(StoreContract, unittest.TestCase):
    def make(self):
        return memory.open_store()


class OpenStoresTests(unittest.TestCase):
    def test_the_setting_wins_then_a_notion_token_then_sqlite(self):
        self.assertEqual(stores.chosen({'JOB_PILOTTO_STORE': 'memory', 'NOTION_TOKEN': 't'}), 'memory')
        self.assertEqual(stores.chosen({'NOTION_TOKEN': 't'}), 'notion')
        self.assertEqual(stores.chosen({}), 'sqlite')

    def test_open_stores_gives_the_chosen_adapter_and_refuses_an_unknown_one(self):
        self.assertEqual(stores.open_stores({'JOB_PILOTTO_STORE': 'memory'}).name, 'memory')
        with self.assertRaises(LookupError):
            stores.open_stores({'JOB_PILOTTO_STORE': 'nosuch'})


if __name__ == '__main__':
    unittest.main()
