"""Every test starts with no store chosen, and a test that leaves one chosen fails by name.

open_stores() reads JOB_PILOTTO_STORE (and the sqlite folder JOB_PILOTTO_DATA_DIR) from os.environ, so a value from the shell,
a developer's .env or an earlier test silently turned open_stores(tracker=fake) into sqlite/memory instead of Notion (9 Oct
2026, three times in one session). Rather than each test guarding itself, unittest discovery loads this file second (sorted
names, after test_0_notion_ids) and wraps TestCase.run for the whole suite: before each test the variables are removed, after
it a test that set them without restoring (a bare os.environ[...] =, a patcher started without addCleanup(stop)) fails and
the value is removed, so the next test is never steered by it. Set them inside a test with mock.patch.dict, as usual."""
import os
import sys
import unittest

STEERING = ('JOB_PILOTTO_STORE', 'JOB_PILOTTO_DATA_DIR')
_run = unittest.TestCase.run


def _clear():
    return {name: os.environ.pop(name) for name in STEERING if name in os.environ}


def run_without_a_chosen_store(self, result=None):
    _clear()
    outcome = _run(self, result)
    left = _clear()
    if left and result is not None:
        try:
            raise AssertionError(f'{self.id()} left {left} in os.environ: set it with mock.patch.dict (or addCleanup(patcher.stop)) '
                                 'so the next test does not open that store')
        except AssertionError:
            result.addFailure(self, sys.exc_info())
    return outcome


run_without_a_chosen_store.guard = True
unittest.TestCase.run = run_without_a_chosen_store
_clear()


class StoreEnvGuardTests(unittest.TestCase):
    def test_the_guard_wraps_every_test(self):
        self.assertTrue(getattr(unittest.TestCase.run, 'guard', False), 'TestCase.run is no longer the store-env guard')

    def test_a_test_starts_without_a_chosen_store(self):
        for name in STEERING:
            self.assertNotIn(name, os.environ)

    def test_a_leaking_test_fails_and_the_next_one_is_not_steered(self):
        class Leaks(unittest.TestCase):
            def test_leak(self):
                os.environ['JOB_PILOTTO_STORE'] = 'sqlite'

            def test_tidy(self):
                from unittest import mock
                with mock.patch.dict(os.environ, {'JOB_PILOTTO_STORE': 'memory'}):
                    pass

        result = unittest.TestResult()
        unittest.defaultTestLoader.loadTestsFromTestCase(Leaks).run(result)
        self.assertEqual([test.id().rsplit('.', 1)[-1] for test, _ in result.failures], ['test_leak'])
        self.assertIn("'JOB_PILOTTO_STORE': 'sqlite'", result.failures[0][1])
        self.assertNotIn('JOB_PILOTTO_STORE', os.environ)


if __name__ == '__main__':
    unittest.main()
