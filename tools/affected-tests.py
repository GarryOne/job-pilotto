"""Which tests a change can break: the local push check runs only these; CI always runs everything. Guarded by tests/test_affected_tests.py.

  python3 tools/affected-tests.py --base origin/main            (JSON on stdout: per area a list of test files, or "all")
  python3 tools/affected-tests.py --files src/store.py desktop/lib/x.js

A test is selected when (1) its transitive imports reach a changed file, (2) its text names a changed file (path, file name or a
Python dotted name: covers fs reads, subprocess calls and fixtures), or (3) it scans the whole tree (always run). A change nothing
maps (dependency files, config, unknown top-level paths, an unreadable source) selects "all" for that area: when in doubt, run it.
"""
import argparse
import ast
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = {'node_modules', '.git', '.claude', 'dist', 'build', '__pycache__', '.venv', 'shared'}
JS_EXT = ('.js', '.mjs', '.cjs')
IMPORT_RE = re.compile(r"""(?:require\(\s*|\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.[^'"]*)['"]""")
SCANNER_RE = re.compile(r'readdirSync|globSync|git ls-files|git ls-tree')
ENGINE_RE = re.compile(r'python|(?:^|[^A-Za-z])src[/.]')
NODE_AREAS = {'desktop': 'desktop/test', 'worker': 'worker/test', 'site': 'site/test'}
ALL_TRIGGERS = re.compile(r'(^|/)(package(-lock)?\.json|requirements[^/]*\.txt|pyproject\.toml|eslint\.config\.mjs)$|^\.github/workflows/build\.yml$')
NO_TEST_EFFECT = re.compile(r'\.md$|^docs/|^LICENSE|\.gitignore$')


def walk(suffixes):
    out = []
    for p in ROOT.rglob('*'):
        if p.is_file() and p.suffix in suffixes and not (set(p.relative_to(ROOT).parts) & SKIP):
            out.append(p)
    return out


def read(p):
    try:
        return p.read_text(errors='replace')
    except OSError:
        return ''


def rel(p):
    return p.relative_to(ROOT).as_posix()


# --- Python import graph -------------------------------------------------------------------------------------------------------------
def py_module_name(p):
    r = p.relative_to(ROOT)
    parts = list(r.with_suffix('').parts)
    if parts[0] == 'tests':        # tests/ is on sys.path as a top-level folder
        parts = parts[1:]
    if parts and parts[-1] == '__init__':
        parts = parts[:-1]
    return '.'.join(parts)


def py_graph():
    files = [p for p in walk({'.py'}) if p.relative_to(ROOT).parts[0] in ('src', 'tests', 'tools')]
    names = {py_module_name(p): p for p in files}
    edges = {}
    for p in files:
        deps = set()
        try:
            tree = ast.parse(read(p))
        except SyntaxError:
            edges[p] = None        # unreadable: the caller treats it as "reaches everything"
            continue
        me = py_module_name(p).split('.')
        pkg = me if p.name == '__init__.py' else me[:-1]
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                targets = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                base = '.'.join(pkg[:len(pkg) - node.level + 1]) if node.level else ''
                mod = '.'.join(x for x in (base, node.module or '') if x)
                targets = [mod] + [f'{mod}.{a.name}'.lstrip('.') for a in node.names]
            else:
                continue
            for t in targets:
                parts = t.split('.')
                for i in range(1, len(parts) + 1):     # a.b.c reaches a, a.b and a.b.c
                    if '.'.join(parts[:i]) in names:
                        deps.add(names['.'.join(parts[:i])])
        edges[p] = deps
    return edges


def is_tree_reader(f):
    """A module a guard test imports to read the repo (scripts/, tools/, test helpers). App code under lib/ scans the user's data folders, not the repo."""
    parts = f.relative_to(ROOT).parts if f.is_relative_to(ROOT) else ()
    return bool(parts) and ('scripts' in parts or 'tools' in parts or 'test' in parts or 'e2e' in parts)


def closure(start, edges):
    seen, stack = set(), [start]
    while stack:
        p = stack.pop()
        if p in seen:
            continue
        seen.add(p)
        deps = edges.get(p, set())
        if deps is None:
            return None
        stack.extend(deps)
    return seen


# --- JavaScript import graph ---------------------------------------------------------------------------------------------------------
def resolve_js(base, spec):
    target = (base.parent / spec).resolve()
    for cand in [target] + [Path(str(target) + e) for e in JS_EXT] + [target / f'index{e}' for e in JS_EXT]:
        if cand.is_file():
            return cand
    return None


def js_graph():
    files = walk(set(JS_EXT))
    edges = {}
    for p in files:
        edges[p.resolve()] = {r for spec in IMPORT_RE.findall(read(p)) if (r := resolve_js(p, spec))}
    return edges


# --- selection -----------------------------------------------------------------------------------------------------------------------
def mentions(text, changed, py_names):
    """Does the test's text name a changed file: its path, its file name (6+ characters), or its Python dotted name?"""
    for f in changed:
        base = Path(f).name
        dotted = py_names.get(f)
        if f in text or (len(base) >= 6 and base in text) or (dotted and dotted in text):
            return True
    return False


def select(changed, base_ref=None):
    changed = sorted(set(changed))
    result = {'python': [], 'desktop': [], 'worker': [], 'site': [], 'reasons': {}}
    why = result['reasons']
    if not changed:
        return result
    relevant = [f for f in changed if not NO_TEST_EFFECT.search(f)]
    if not relevant:
        return result
    everything = [f for f in relevant if ALL_TRIGGERS.search(f) or f == 'tests/test_0_notion_ids.py']
    areas = {'python': (lambda f: f.startswith(('src/', 'tests/', 'tools/', 'config/', 'templates/'))),
             'desktop': (lambda f: f.startswith(('desktop/', 'extension/'))),
             'worker': (lambda f: f.startswith(('worker/', 'extension/'))),
             'site': (lambda f: f.startswith('site/'))}
    known = tuple(['src/', 'tests/', 'tools/', 'config/', 'templates/', 'desktop/', 'extension/', 'worker/', 'site/', '.github/', 'docs/'])
    unknown = [f for f in relevant if not f.startswith(known)]
    if everything or unknown:
        why['all'] = everything + unknown
        return {**{k: 'all' for k in ('python', 'desktop', 'worker', 'site')}, 'reasons': why}

    # Python
    py_changed = [f for f in relevant if areas['python'](f)]
    if py_changed:
        edges = py_graph()
        changed_paths = {ROOT / f for f in py_changed}
        non_py_src = [f for f in py_changed if not f.endswith('.py') and f.startswith(('src/', 'config/', 'templates/'))]
        if non_py_src:
            result['python'] = 'all'; why['python'] = f'non-code input read by the engine: {non_py_src[0]}'
        else:
            names = {f: py_module_name(ROOT / f) for f in py_changed if f.endswith('.py')}
            picked = []
            for t in sorted((ROOT / 'tests').glob('test_*.py')):
                reach = closure(t, edges)
                if reach is None or reach & changed_paths or mentions(read(t), py_changed, names):
                    picked.append(t.stem)
            result['python'] = picked
            orphans = [f for f in names if f.startswith('src/') and not any(
                (ROOT / f) in (closure(t, edges) or {ROOT / f}) for t in (ROOT / 'tests').glob('test_*.py'))]
            if orphans and not picked:   # an engine file no test reaches: nothing could fail, so run the lot rather than nothing
                result['python'] = 'all'; why['python'] = f'no test reaches {orphans[0]}'
    # Node areas
    graph = None
    engine_changed = any(f.startswith(('src/', 'tests/')) for f in relevant)
    for area, folder in NODE_AREAS.items():
        if not any(areas[area](f) for f in relevant) and not (area == 'desktop' and engine_changed):
            continue
        graph = graph or js_graph()
        changed_js = {(ROOT / f).resolve() for f in relevant}
        tests = sorted((ROOT / folder).glob('*.test.*')) if (ROOT / folder).is_dir() else []
        picked, scans = [], {}   # scans: file -> does its text scan the tree (a guard may scan through a module it imports, 10 Oct 2026)
        for t in tests:
            text = read(t)
            reach = closure(t.resolve(), graph)
            scanner = bool(SCANNER_RE.search(text)) or any(scans.setdefault(f, bool(SCANNER_RE.search(read(f)))) for f in reach if is_tree_reader(f))
            if (reach & changed_js) or mentions(text, relevant, {}) or scanner \
                    or (area == 'desktop' and engine_changed and ENGINE_RE.search(text)):
                picked.append(rel(t)[len(area) + 1:])
        result[area] = picked
    return result


def git_changed(base):
    for spec in (f'{base}...HEAD', f'{base}..HEAD'):
        out = subprocess.run(['git', 'diff', '--name-only', spec], cwd=ROOT, capture_output=True, text=True)
        if out.returncode == 0:
            return [l for l in out.stdout.splitlines() if l]
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--base', help='compare HEAD with this ref (merge base)')
    ap.add_argument('--files', nargs='*', help='changed files, instead of git')
    args = ap.parse_args(argv)
    changed = args.files if args.files is not None else git_changed(args.base or 'origin/main')
    if changed is None:       # no way to know what changed: everything
        print(json.dumps({'python': 'all', 'desktop': 'all', 'worker': 'all', 'site': 'all', 'reasons': {'all': ['git diff failed']}}))
        return 0
    print(json.dumps(select(changed)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
