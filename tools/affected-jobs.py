"""Which CI jobs a pull request needs: each required job's first step asks (tools/ci-needed.sh) and skips its heavy steps on "skip". Guarded by tests/test_affected_jobs.py.

  python3 tools/affected-jobs.py --job desktop --base HEAD^1      (one line: "run: <why>" or "skip: <why>")
  python3 tools/affected-jobs.py --files tools/ship.sh            (JSON: every job -> why it runs, or null)

The push hook's pick (tools/affected-tests.py: its import graphs, a test naming a changed file), asked per job about EVERY changed file: a desktop test
reads tools/, a Python test reads extension/, and Markdown counts (tests read CLAUDE.md, docs/HOW-IT-RUNS.md). A job runs when one of its tests
(1) imports a changed file, (2) names it, or (3) itself or a module it imports names a folder holding it (a quoted path, or path pieces joined:
join(here, '..', 'lib'), ROOT / 'src') or lists the whole repo (git ls-files without a folder, ROOT.rglob: any change). A change inside a job's own
folders always runs it (its lint, its tests' own scans). The replay jobs run for what tools/replay-files.mjs says a replay loads. The jobs' plumbing
(this pick, their workflows, check.py) and root dependency files run every job. When in doubt: run. A push to main runs every job whole: the backstop.
"""
import argparse
import functools
import importlib.util
import json
import posixpath
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location('affected_tests', ROOT / 'tools/affected-tests.py')
pick = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pick)

APP_INSTALL = ('desktop/package.json', 'desktop/package-lock.json')        # the app's own packages: the harness and replay jobs install them
E2E_INSTALL = ('desktop/e2e/package.json', 'desktop/e2e/package-lock.json')
# job -> (its tests: folder and pattern, or None for a replay job; the paths a change to always runs it: its folders (end with /) and what it installs or runs)
JOBS = {
    'python': (('tests', 'test_*.py'), ('src/', 'tests/', 'tools/', 'config/', 'templates/', '.github/workflows/')),
    'desktop': (('desktop/test', '*.test.*'), ('desktop/', 'extension/')),   # its lint reads all of desktop/ and extension/
    'worker': (('worker/test', '*.test.*'), ('worker/',)),
    'site': (('site/test', '*.test.*'), ('site/',)),
    'harness': (('desktop/e2e/test', '*.test.mjs'), ('desktop/e2e/', 'desktop/scripts/stage.mjs') + APP_INSTALL),
    'replays': (None, APP_INSTALL + E2E_INSTALL),
    'zoo': (None, ('desktop/scripts/stage.mjs',) + APP_INSTALL + E2E_INSTALL),
    'e2e-flow': (None, ('.github/workflows/e2e.yml', '.github/workflows/e2e-flow.yml', '.github/workflows/flow-canary.yml', '.github/workflows/pool-smoke.yml')),   # optional (tests OPTIONAL): apply + applycv and the live canary on flow PRs
}
# Jobs that run ONLY for what they load and their own files (owner, 13 Oct 2026: "only the specific cases, when it's really relevant"): never for the plumbing,
# root dependencies, lock files or an unknown file that run every other job whole. Main's schedule is their backstop for those.
OWN_ONLY = ('e2e-flow',)
STAGES = ('harness', 'zoo')   # the jobs that run desktop/scripts/stage.mjs --files-only: what it copies into desktop/shared counts as theirs
# What runs the jobs themselves: a change to one runs every job whole.
PLUMBING = re.compile(r'^(tools/(affected-(tests|jobs)\.py|replay-files\.mjs|ci-needed\.sh|check\.(sh|py)|py-shards\.py)|\.github/workflows/(build|pr-gate|recorded-pages|widget-zoo)\.yml)$')

LITERAL = re.compile(r"""'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`""")
JOINED = re.compile(r'^\s*[,/+]\s*$')                 # 'a', 'b' (join), 'a' / 'b' (pathlib), 'a' + '/b'
COMMENT = re.compile(r'^\s*(//|#|\*|/\*)')
PATHISH = re.compile(r"join\(|resolve\(|URL\(|ls-files|ls-tree|readdirSync|readFileSync|existsSync|statSync|rglob|glob\(|Path\(|\b(ROOT|REPO|root|repo|here|HERE)\b|__dirname|import\.meta|/\s*['\"]")
WHOLE = re.compile(r"\b(?:ROOT|REPO|root|repo)\s*\.\s*rglob\(|os\.walk\(\s*(?:ROOT|REPO|root|repo)\b|readdirSync\(\s*(?:ROOT|REPO|root|repo)\s*,\s*\{[^}]*recursive")
LISTS = re.compile(r'ls-files|ls-tree')
SCANS = re.compile(r'readdirSync|globSync|ls-files|ls-tree|rglob|\.glob\(|os\.walk|listdir|iterdir|scandir')


def resolve(candidate, bases):
    """-> the repo file or folder (a folder ends with /) a quoted path names, from the first base it exists in (its own folder, then its area: 'src' in a
    site test is site/src); nothing for a pattern or a path outside the repo. Bases and the answer are repo-relative ('' is the repo)."""
    if not candidate or len(candidate) > 200 or re.search(r'[*{}$\s<>|]', candidate) or candidate.startswith('/'):
        return set()
    for base in bases:
        target = posixpath.normpath(posixpath.join(base, candidate))
        parts = target.split('/')
        if target not in ('.', '') and parts[0] != '..' and not (set(parts) & pick.SKIP) and exists(tuple(parts)):
            return {target + ('/' if (ROOT / target).is_dir() else '')}
    return set()


@functools.lru_cache(maxsize=None)
def listing(folder):
    try:
        return frozenset(entry.name for entry in (ROOT / folder).iterdir())
    except OSError:
        return frozenset()


def exists(parts):
    """Does the repo hold this path, spelled exactly so? A Mac's disk ignores case ('Tools' finds tools/); CI's Linux does not."""
    return all(part in listing('/'.join(parts[:i])) for i, part in enumerate(parts))


@functools.lru_cache(maxsize=None)
def named(path):
    """-> (the repo files and folders a source names in its code, not its comments: quoted paths and joined path pieces; does it list the whole repo?)"""
    me = pick.rel(path)
    bases = [posixpath.dirname(me), me.split('/')[0], '']   # its own folder, its area (desktop/, site/), the repo
    found, whole = set(), False
    text = pick.read(path)
    scanner = bool(SCANS.search(text))   # a file that lists folders may keep their names in a table (codemap.mjs: ['Tools', 'tools', ...]): every quoted word counts
    for line in text.splitlines():
        if COMMENT.match(line):
            continue
        hits = list(LITERAL.finditer(line))
        runs = []
        for i, hit in enumerate(hits):
            word = next(group for group in hit.groups() if group is not None)
            if re.search(r'\$?\{', word):   # `../lib/${name}.js`, f'src/{name}.py': the folder before the computed part is what is read
                word = word[:re.search(r'\$?\{', word).start()].rpartition('/')[0]
            if runs and JOINED.match(line[hits[i - 1].end():hit.start()]):
                runs[-1].append(word)
            else:
                runs.append([word])
        on_line, pathish, scans = set(), PATHISH.search(line), SCANS.search(line)
        for run in runs:
            joined = '/'.join(piece.strip('/') for piece in run)
            if not (len(run) > 1 or '/' in joined or pathish or scanner):   # a word ('site') counts on a line that builds a path, or in a file that lists folders
                continue
            anchor = lambda candidate: re.fullmatch(r'[./]*', candidate) and not scans   # '..', '../..': what the real path is joined to, not what is read
            hits = set() if anchor(joined) else resolve(joined, bases)
            rest = run[next((i for i, piece in enumerate(run) if not re.fullmatch(r'[./]*', piece)), len(run)):]
            if not hits and rest and len(rest) < len(run):   # join(E2E, '..', '..', 'tests', 'fixtures', 'x.json'): the anchor is a variable; the rest is a repo path
                hits = resolve('/'.join(rest), bases)
            if not hits and len(run) > 1 and (scanner or pathish):   # ['git', 'ls-files', 'src'], ['Tools', 'tools', /re/]: one of the pieces is the folder
                hits = set().union(*(resolve(piece, bases) for piece in run if not anchor(piece) and ('/' in piece or pathish or scanner)))
            on_line |= hits
        found |= on_line
        if LISTS.search(line) and not any(p.endswith('/') for p in on_line):
            whole = True
        if WHOLE.search(line):
            whole = True
    return frozenset(found), whole


@functools.lru_cache(maxsize=None)
def staged():
    """-> what desktop/scripts/stage.mjs --files-only copies into desktop/shared (its lines before the files-only exit), as repo paths."""
    path = ROOT / 'desktop/scripts/stage.mjs'
    text = pick.read(path).split('if (filesOnly)')[0]
    found = set()
    for line in text.splitlines():
        if re.search(r'\bcopy\(|copyFileSync\(', line) and not COMMENT.match(line):
            pieces = re.findall(r"'([^']+)'", line.split(', path.join(out')[0])
            found |= resolve('/'.join(pieces), [''])
    return frozenset(found)


@functools.lru_cache(maxsize=None)
def loads(job):
    """-> the files and folders a replay job loads (tools/replay-files.mjs --job), or None when node cannot say."""
    try:
        out = subprocess.run(['node', str(ROOT / 'tools/replay-files.mjs'), '--job', job], cwd=ROOT, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    lines = [line for line in out.stdout.splitlines() if line]
    return frozenset(lines) if out.returncode == 0 and lines else None


def names(text, file, py_names):
    """Does a test's text name a changed file: its path, its file name (6+ characters) standing alone, its Python dotted name (the push pick's rule,
    tools/affected-tests.py mentions(), with edges: 'desktop/e2e/README.md' does not name the root README.md; a relative path is named() 's)?"""
    if pick.WORKFLOW_DIR_RE.search(text) and file.startswith('.github/workflows/'):
        return True
    alone = lambda word: re.search(r'(?<![\w./-])' + re.escape(word) + r'(?![\w-])', text)
    base, dotted = Path(file).name, py_names.get(file)
    return bool(alone(file) or (len(base) >= 6 and alone(base)) or (dotted and alone(dotted)))


def under(file, paths):
    return next((p for p in paths if file == p or (p.endswith('/') and file.startswith(p))), None)


@functools.lru_cache(maxsize=None)
def profile(job):
    """-> per test of the job, read once per process: (its name, the repo files its imports reach or None, its text, [(through which module, the paths named,
    whole repo?)]). Paths are repo-relative strings: pathlib in this loop took ~45 s over the ~600 tests (12 Oct 2026)."""
    folder, pattern = JOBS[job][0]
    python = folder == 'tests'
    graph = pick.py_graph() if python else pick.js_graph()
    out = []
    for test in sorted((ROOT / folder).glob(pattern)):
        reach = pick.closure(test if python else test.resolve(), graph)
        reach = None if reach is None else frozenset(f for f in map(relative, reach) if f)
        name = pick.rel(test)
        readers = [name] + sorted(f for f in (reach or ()) if f != name and tree_reader(f))
        out.append((name, reach, pick.read(test), [('' if f == name else f' (through {f})', *named(ROOT / f)) for f in readers]))
    return out


def relative(path, root=ROOT.as_posix() + '/'):
    """-> the repo-relative path with / (also on the Windows desktop job), or None for a file outside the repo (a linked node_modules: its package.json
    is what changes)."""
    text = Path(path).as_posix()
    return text[len(root):] if text.startswith(root) else None


def tree_reader(file):
    """tools/affected-tests.py is_tree_reader() on a repo-relative path."""
    return bool({'scripts', 'tools', 'test', 'e2e'} & set(file.split('/')))


ALL = object()   # a test this pick cannot read, or one that lists the whole repo: every test of the job runs


def _reached(job, changed):
    """-> (test name, why) for each of the job's tests a change reaches, in order; (ALL, why) first when the pick cannot tell which."""
    changed_paths = {posixpath.normpath(f): f for f in changed}
    py_names = {f: pick.py_module_name(ROOT / f) for f in changed if f.endswith('.py') and f.startswith(('src/', 'tests/', 'tools/'))}
    engine = any(f.startswith('src/') or (f.startswith('tests/') and not re.fullmatch(r'tests/test_[^/]+\.py', f)) for f in changed)
    for name, reach, text, sources in profile(job):
        if reach is None:
            yield ALL, f'{name} imports a file this pick cannot read'; continue
        hit = next((changed_paths[p] for p in changed_paths if p in reach), None)
        if hit:
            yield name, f'{name} imports {hit}'; continue
        hit = next((f for f in changed if names(text, f, py_names)), None)
        if hit:
            yield name, f'{name} names {hit}'; continue
        if job == 'desktop' and engine and pick.ENGINE_RE.search(text):
            yield name, f'{name} runs the engine (src/ changed)'; continue
        for via, paths, whole in sources:
            if whole:
                yield ALL, f'{name} lists the whole repo{via}'; break
            hit = next((f for f in changed if under(f, paths)), None)
            if hit:
                yield name, f'{name} reads {under(hit, paths)}{via}: {hit}'; break


def first_test(job, changed):
    """-> why the first of the job's tests that a change reaches is reached, or None."""
    return next((why for _, why in _reached(job, changed)), None)


def tests_reached(job, changed):
    """-> the job's tests a change reaches, as the job runs them (relative to its test folder's parent: test/x.test.mjs), or None: run them all (its own folder,
    plumbing, a test this pick cannot read). [] when none (the job skips). Owner, 13 Oct 2026, on #553: one guard test reached, the whole harness ran."""
    changed = sorted(set(changed))
    why = reason(job, changed)
    if why is None:
        return []
    folder = JOBS[job][0]
    if folder is None or why != first_test(job, changed):
        return None
    base = posixpath.dirname(folder[0]) + '/'
    out = []
    for name, _ in _reached(job, changed):
        if name is ALL:
            return None
        if name.startswith(base) and name[len(base):] not in out:
            out.append(name[len(base):])
    return out


def reason(job, changed):
    """-> why this change can break the job, or None: it may skip."""
    changed = sorted(set(changed))
    if not changed:
        return 'no changed file listed: run'
    every = next((f for f in changed if PLUMBING.match(f) or f == 'tests/test_0_notion_ids.py' or (pick.ALL_TRIGGERS.search(f) and not pick.SCOPED_DEPS.match(f))
                  or not (f.startswith(pick.KNOWN) or pick.NO_TEST_EFFECT.search(f))), None)
    if every and job not in OWN_ONLY:
        return f'{every} runs every job'
    tests, own = JOBS[job]
    hit = next((f for f in changed if under(f, own) or f.startswith(own)), None)
    if hit is None and job in STAGES:
        hit = next((f for f in changed if under(f, staged())), None)
    if hit:
        return f'{hit} is its own (folder, install or staged copy)'
    if tests is None:
        files = loads(job)
        if files is None:
            return 'node could not list what the replay loads: run'
        hit = next((f for f in changed if under(f, files)), None)
        return f'the replay loads {hit}' if hit else None
    return first_test(job, changed)


def reasons(changed):
    """-> {job: why this change can break it, or None}."""
    return {job: reason(job, changed) for job in JOBS}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--job', choices=sorted(JOBS), help='one job: prints "run: <why>" or "skip: <why>"')
    ap.add_argument('--base', help='compare HEAD with this ref (merge base)')
    ap.add_argument('--files', nargs='*', help='changed files, instead of git')
    ap.add_argument('--tests', action='store_true', help='with --job: print the tests it should run, space-separated, or "all"')
    args = ap.parse_args(argv)
    changed = args.files if args.files is not None else pick.git_changed(args.base or 'origin/main')
    if args.job and args.tests:
        picked = None if changed is None else tests_reached(args.job, changed)
        print('all' if picked is None else ' '.join(picked))
        return 0
    if not args.job:
        print(json.dumps({job: 'git diff failed: run' for job in JOBS} if changed is None else reasons(changed), indent=1))
        return 0
    why = 'git diff failed: run' if changed is None else reason(args.job, changed)
    print(f'run: {why}' if why else f'skip: no test of {args.job} reaches any of the {len(changed)} changed files')
    return 0


if __name__ == '__main__':
    sys.exit(main())
