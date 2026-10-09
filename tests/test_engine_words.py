"""What the engine writes for the user names the AI that answered, never a hard-coded "Claude" (owner, 9 Oct 2026).

The chosen engine's word comes from src/ai/providers who(): 'Claude' (Anthropic key, Claude Code), 'OpenAI', 'Codex'; the app says the same
(desktop/lib/ai). Claude-only things keep their names: Claude Code, the Claude plan or subscription, Claude in Chrome, Apply/Read with Claude.
This reads every string literal in src/ (docstrings and comments are not shown to anyone) and fails on a new bare "Claude".
"""
import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# "Claude" followed by one of these is a Claude-only thing, named on purpose.
KEPT = re.compile(r"\bClaude(?= Code| plan| subscription| usage window| in Chrome|\s*\(your Claude plan\))|(?:with|With) Claude\b|Claude's own|your Claude\b")
# Files about the Claude-only features (Apply/Read with Claude sessions and their agent names), the Claude Code engine's own texts, and the
# registry that defines the word itself.
CLAUDE_ONLY = {'src/ai/apply_batch.py', 'src/ai/apply_run.py', 'src/ai/providers/claude_code.py', 'src/ai/providers/__init__.py',
               'src/notion/ledger_record.py', 'src/notion/runs.py'}


def docstrings(tree):
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                found.add(id(first.value))
    return found


def bare_claude(root=ROOT):
    """[(file:line, text)] of string literals in src/ that say "Claude" where the chosen engine's name belongs."""
    hits = []
    for path in sorted((root / 'src').rglob('*.py')):
        name = str(path.relative_to(root))
        if name in CLAUDE_ONLY:
            continue
        tree = ast.parse(path.read_text())
        skip = docstrings(tree)
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in skip and 'Claude' in node.value:
                if re.search(r'\bClaude\b', KEPT.sub('', node.value)):
                    hits.append((f'{name}:{node.lineno}', node.value[:120]))
    return hits


class EngineWordsTest(unittest.TestCase):
    def test_no_bare_claude_in_what_the_engine_writes(self):
        self.assertEqual(bare_claude(), [], 'name the engine with providers.who() (or say "the AI"); Claude-only features keep "Claude …"')

    def test_the_check_catches_one(self):
        """A positive control: a planted line is found, a Claude-only name is not."""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'src').mkdir()
            (Path(tmp) / 'src' / 'x.py').write_text('"""Claude in a docstring is fine."""\nA = "Claude placed 3 locations"\nB = "Claude Code is not signed in"\n')
            self.assertEqual([hit[1] for hit in bare_claude(Path(tmp))], ['Claude placed 3 locations'])


if __name__ == '__main__':
    unittest.main()
