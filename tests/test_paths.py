import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import paths


class DotenvTests(unittest.TestCase):
    def setUp(self):
        self.saved_root = paths.ROOT
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: paths.__setattr__('ROOT', self.saved_root))
        self.addCleanup(os.environ.pop, 'JOB_PILOTTO_TEST_VAR', None)
        self.addCleanup(os.environ.pop, 'JOB_PILOTTO_TEST_EXISTING', None)

    def test_loads_unset_vars_without_overriding_existing_ones(self):
        (self.tmp / '.env').write_text(
            '# a comment\n'
            '\n'
            'JOB_PILOTTO_TEST_VAR=hello world\n'
            'JOB_PILOTTO_TEST_EXISTING=from-dotenv\n'
            'export JOB_PILOTTO_TEST_QUOTED="quoted value"\n'
        )
        os.environ['JOB_PILOTTO_TEST_EXISTING'] = 'from-shell'
        paths.ROOT = self.tmp
        paths._load_dotenv()
        self.assertEqual(os.environ['JOB_PILOTTO_TEST_VAR'], 'hello world')
        self.assertEqual(os.environ['JOB_PILOTTO_TEST_EXISTING'], 'from-shell')
        self.assertEqual(os.environ.pop('JOB_PILOTTO_TEST_QUOTED'), 'quoted value')

    def test_missing_env_file_is_a_no_op(self):
        paths.ROOT = self.tmp  # no .env written here
        paths._load_dotenv()  # must not raise


if __name__ == '__main__':
    unittest.main()
