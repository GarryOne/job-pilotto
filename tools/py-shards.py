"""Run the Python unit tests in parallel shards (one `unittest` process per shard); guarded by tests/test_py_shards.py.

Same tests as `python -m unittest discover -s tests`, split by module so wall time drops from the sum to roughly the slowest shard.
  python3 tools/py-shards.py [--jobs N] [--app-only] [module ...]   (no module = every tests/test_*.py)
Modules are balanced by measured seconds (tools/py-shard-weights.json, modules over 1.5 s; the rest count 0.5 s), slowest first; a stale weight only costs speed, never coverage.
Width: cores / push-check slots (4 here: two push checks at once, each with the journey gate and the other suites beside it; 8 wide drove the load to 124-152, 11 Oct 2026). The slow modules (test_ship, test_heavy_lock, test_pre_push_check) are sleep- and git-bound, so they overlap well (11 Oct 2026: 4 shards ~84 s, the longest module 50 s).
Exit 0 when every shard passed; otherwise 1 with each failing shard's output on stderr.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests'
BOOTSTRAP = 'test_0_notion_ids'
# Tests of this repo's own scripts and hooks (git, bash, the push hook, ship, worktrees): not the desktop app. The release run's Build box leaves them out with --app-only
# (owner, 10 Oct 2026: "unit tests only related to the desktop app"); CI · Tests, without the flag, still runs them on every push.
DEV_TOOLING = ('test_affected_tests', 'test_check', 'test_check_slot', 'test_commit_subject', 'test_pre_push_check',
               'test_release_stable_guard', 'test_ship', 'test_stop_means_stop', 'test_worktree')


def all_modules():
    return sorted(p.stem for p in TESTS.glob('test_*.py'))


WEIGHTS = ROOT / 'tools' / 'py-shard-weights.json'


def weights():
    try:
        return json.loads(WEIGHTS.read_text())
    except (OSError, ValueError):
        return {}


def split(modules, jobs):
    """Greedy: slowest module first into the lightest shard. Every module lands in exactly one shard."""
    seconds = weights()
    shards = [[] for _ in range(max(1, min(jobs, len(modules))))]
    load = [0] * len(shards)
    for name in sorted(modules, key=lambda m: (-seconds.get(m, 0.5), m)):
        i = load.index(min(load))
        shards[i].append(name)
        load[i] += seconds.get(name, 0.5)
    return [s for s in shards if s]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('modules', nargs='*', help='test modules to run (default: all)')
    parser.add_argument('--app-only', action='store_true', help='leave out the tests of this repo\'s own dev tooling (DEV_TOOLING)')
    parser.add_argument('--jobs', type=int, default=int(os.environ.get('JOB_PILOTTO_PY_JOBS', 0)) or max(2, (os.cpu_count() or 4) // int(os.environ.get('JOB_PILOTTO_CHECK_SLOTS', 2) or 2)))   # JOB_PILOTTO_PY_JOBS=4 (or --jobs 4) is the old width; JOB_PILOTTO_PY_SERIAL=1 (tools/check.py) one process
    args = parser.parse_args(argv)
    modules = args.modules or all_modules()
    if args.app_only:
        modules = [m for m in modules if m not in DEV_TOOLING]
    if not modules:
        print('py-shards: no test modules found', file=sys.stderr)
        return 2
    env = dict(os.environ)
    env['PYTHONPATH'] = os.pathsep.join([str(TESTS), env.get('PYTHONPATH', '')]).rstrip(os.pathsep)
    started = time.monotonic()
    # test_0_notion_ids sets the fake IDs the whole suite imports against; discovery loads it first, so every shard does too.
    procs = [(shard, subprocess.Popen([sys.executable, '-m', 'unittest', '-q', '-b', BOOTSTRAP, *[m for m in shard if m != BOOTSTRAP]], cwd=ROOT, env=env,
                                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True))
             for shard in split(modules, args.jobs)]
    failed = ran = 0
    for shard, proc in procs:
        out, _ = proc.communicate()
        ran += sum(int(n) for n in re.findall(r'^Ran (\d+) tests?', out, re.M))
        if proc.returncode:
            failed += 1
            print(f'py-shards: shard FAILED ({len(shard)} modules: {", ".join(shard[:4])}...)\n{out}', file=sys.stderr)
    ran -= len(procs) - 1   # the bootstrap module's one test runs in every shard
    print(f'py-shards: {len(modules)} modules, {ran} tests, {len(procs)} shards, {"FAILED" if failed else "passed"} ({time.monotonic() - started:.1f}s)')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
