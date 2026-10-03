"""A test class or method defined twice under one name silently drops the first: unittest only sees the last. This happened to
HuxleyFollowUpTests in tests/test_mail.py (3 Oct 2026): its fuller test, with the repeat-event check, never ran."""
import ast
import collections
import glob
import unittest
from pathlib import Path

HERE = Path(__file__).parent


class ShadowedTests(unittest.TestCase):
    def test_no_test_file_defines_a_class_or_a_test_twice(self):
        problems = []
        for path in sorted(glob.glob(str(HERE / 'test_*.py'))):
            tree = ast.parse(Path(path).read_text())
            classes = collections.Counter(node.name for node in tree.body if isinstance(node, ast.ClassDef))
            problems += [f'{Path(path).name}: class {name} is defined {count} times' for name, count in classes.items() if count > 1]
            for node in tree.body:
                if isinstance(node, ast.ClassDef):
                    methods = collections.Counter(item.name for item in node.body if isinstance(item, ast.FunctionDef))
                    problems += [f'{Path(path).name}: {node.name}.{name} is defined {count} times' for name, count in methods.items() if count > 1]
        self.assertEqual(problems, [])


if __name__ == '__main__':
    unittest.main()
