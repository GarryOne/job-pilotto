"""A fingerprint of the code that reads job sites: when it changes, verdicts made by the older code are looked at again.

Only the code counts: comments, docstrings and print() lines are left out, so a wording change does not undo every verdict (owner,
7 Oct 2026: a run of 92 checked 36 employers again and 4 new ones, because a summary line in scout.py had changed)."""
import ast
import hashlib
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent


class _Wording(ast.NodeTransformer):
    """Drops docstrings and print(...) statements: words for people, not how a site is read."""

    def visit_Expr(self, node):
        value = node.value
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            return None
        if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == 'print':
            return None
        return node


def code_fingerprint(files, only=None):
    """12 hex characters for `files` (paths under src/). `only` maps a file to the names of its functions that count (the rest of it is
    left out); a file that cannot be read counts by its name."""
    only = only or {}
    digest = hashlib.sha256()
    for name in files:
        try:
            tree = ast.parse((SRC / name).read_text(encoding='utf-8'))
        except (OSError, SyntaxError):
            digest.update(name.encode())
            continue
        nodes = tree.body
        if name in only:
            nodes = sorted((n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in only[name]),
                           key=lambda n: n.name)
        for node in nodes:
            node = _Wording().visit(node)
            if node is not None:   # a module's docstring or a top-level print
                digest.update(ast.dump(node).encode())
    return digest.hexdigest()[:12]
