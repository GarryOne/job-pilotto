"""No function imports a name its module already imports and uses that name before the local import: Python then treats the name as
local for the whole function, and the earlier use crashes with UnboundLocalError (7 Oct 2026: `from . import store` inside
src/desktop.py main() broke every `python -m src.desktop` command, so the Calendar, Jobs and Strategy could not refresh)."""
import ast
from pathlib import Path
import unittest

SRC = Path(__file__).resolve().parents[1] / 'src'


def imported(nodes):
    return {(alias.asname or alias.name.split('.')[0]): node.lineno for node in nodes if isinstance(node, (ast.Import, ast.ImportFrom))
            for alias in node.names}


def used_before_local_import(tree):
    found = []
    module = imported(tree.body)
    for func in ast.walk(tree):
        if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        local = {}
        for node in ast.walk(func):
            for name, line in imported([node]).items():
                local[name] = min(line, local.get(name, line))
        for name, line in local.items():
            if name in module and any(isinstance(n, ast.Name) and n.id == name and n.lineno < line for n in ast.walk(func)):
                found.append(f'{func.name}:{line} {name}')
    return found


class ShadowedImportsTest(unittest.TestCase):
    def test_no_function_uses_a_name_before_importing_it_again(self):
        problems = [f'{path.relative_to(SRC.parent)} {hit}' for path in sorted(SRC.rglob('*.py'))
                    for hit in used_before_local_import(ast.parse(path.read_text()))]
        self.assertEqual(problems, [])

    def test_the_check_sees_the_bug(self):   # positive control: the shape that broke src/desktop.py
        tree = ast.parse('from . import store\ndef main():\n    store.connect()\n    if 1:\n        from . import store\n')
        self.assertEqual(used_before_local_import(tree), ['main:5 store'])


if __name__ == '__main__':
    unittest.main()
