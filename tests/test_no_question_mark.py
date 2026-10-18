"""No question-mark emoji in text the engine writes for the user (Notion pages and titles, run lines, Telegram, Focus): owner, 18 Oct 2026."""
import ast
import pathlib
import unittest

MARK = chr(0x2753)
SRC = pathlib.Path(__file__).resolve().parent.parent / 'src'
# The Profile template's own marker is a data format the engine READS (score.py, doctor.py) and tells the AI about (kit.py's prompt and schema strings,
# long sentences); nothing there is drawn. A short string with the marker, anywhere, is text a person would see.
LONG = 40
READERS = {'score.py', 'doctor.py'}   # they test a line for the marker; they draw nothing


def strings(path):
    tree = ast.parse(path.read_text(encoding='utf8'))
    docstrings = {id(node.body[0].value) for node in ast.walk(tree)
                  if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef))
                  and node.body and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant)}
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and MARK in node.value and id(node) not in docstrings:
            yield node.lineno, node.value


class NoQuestionMark(unittest.TestCase):
    def test_no_short_string_with_the_marker_in_any_engine_file(self):
        found = [f'{path.relative_to(SRC)}:{line}: {text[:60]!r}' for path in sorted(SRC.rglob('*.py'))
                 for line, text in strings(path) if len(text) < LONG and path.name not in READERS]
        self.assertEqual(found, [], 'text with the marker reaches a user (Notion, Telegram, Focus); say it in words')

    def test_the_marker_is_only_in_long_prompt_or_template_strings(self):
        files = {path.name for path in SRC.rglob('*.py') for _ in strings(path)}
        self.assertLessEqual(files, {'kit.py', 'score.py', 'doctor.py'}, files)


if __name__ == '__main__':
    unittest.main()
