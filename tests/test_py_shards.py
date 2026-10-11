"""tools/py-shards.py (9 Oct 2026): the Python suite split across parallel processes. The split must never drop or duplicate a test module."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('py_shards', ROOT / 'tools/py-shards.py')
shards = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shards)


class ShardTests(unittest.TestCase):
    def test_every_module_lands_in_exactly_one_shard_for_any_job_count(self):
        modules = shards.all_modules()
        self.assertGreater(len(modules), 100)
        for jobs in (1, 2, 4, 7, 500):
            flat = [m for shard in shards.split(modules, jobs) for m in shard]
            self.assertEqual(sorted(flat), sorted(modules), f'jobs={jobs}')

    def test_the_slow_modules_land_in_different_shards_and_the_weights_name_real_modules(self):
        # 11 Oct 2026: balanced by file size, test_ship and test_heavy_lock (50 s each) could share a shard; the weights are measured seconds
        weights = shards.weights()
        modules = shards.all_modules()
        self.assertTrue(set(weights) <= set(modules), f'weights for modules that do not exist: {sorted(set(weights) - set(modules))}')
        slowest = sorted(weights, key=weights.get, reverse=True)[:4]
        placed = shards.split(modules, 8)
        homes = [next(i for i, shard in enumerate(placed) if name in shard) for name in slowest]
        self.assertEqual(len(set(homes)), len(slowest), f'the slowest modules {slowest} share a shard')

    def test_the_bootstrap_module_that_sets_the_fake_ids_exists(self):
        self.assertIn(shards.BOOTSTRAP, shards.all_modules())

    def test_the_dev_tooling_left_out_of_the_build_exist_and_are_the_only_difference(self):
        everything = shards.all_modules()
        for name in shards.DEV_TOOLING:
            self.assertIn(name, everything, f'{name} is listed as dev tooling but there is no tests/{name}.py: a renamed file would silently join the Build box')
        app = [m for m in everything if m not in shards.DEV_TOOLING]
        self.assertEqual(len(app) + len(shards.DEV_TOOLING), len(everything))
        self.assertGreater(len(app), 150, 'the Build box still runs the product\'s Python tests')


if __name__ == '__main__':
    unittest.main()
