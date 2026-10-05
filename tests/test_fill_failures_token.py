"""tools/fill-failures.py uses the first token that can open the app's Agent Runs database, not the first one in the Keychain."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('fill_failures', Path(__file__).resolve().parent.parent / 'tools' / 'fill-failures.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class TokenForTest(unittest.TestCase):
    def test_the_token_that_opens_the_database_wins(self):
        opens = lambda token: token == 'real'
        self.assertEqual(tool.token_for('db', ['', 'test-workspace', 'real'], opens), 'real')
        self.assertEqual(tool.token_for('db', ['real', 'real'], opens), 'real')
        self.assertEqual(tool.token_for('db', ['test-workspace'], opens), '')


if __name__ == '__main__':
    unittest.main()
