"""Run the Python unit tests in parallel shards (one `unittest` process per shard); guarded by tests/test_py_shards.py.

Same tests as `python -m unittest discover -s tests`, split by module so wall time drops from the sum to roughly the slowest shard.
  python3 tools/py-shards.py [--jobs N] [--app-only] [module ...]   (no module = every tests/test_*.py)
Modules are balanced by file size, biggest first (a cheap stand-in for run time; a wrong guess only costs speed, never coverage).
Exit 0 when every shard passed; otherwise 1 with each failing shard's output on stderr.
"""
import argparse
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


def split(modules, jobs):
    """Greedy: biggest module first into the lightest shard. Every module lands in exactly one shard."""
    shards = [[] for _ in range(max(1, min(jobs, len(modules))))]
    load = [0] * len(shards)
    for name in sorted(modules, key=lambda m: (-(TESTS / f'{m}.py').stat().st_size, m)):
        i = load.index(min(load))
        shards[i].append(name)
        load[i] += (TESTS / f'{name}.py').stat().st_size
    return [s for s in shards if s]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('modules', nargs='*', help='test modules to run (default: all)')
    parser.add_argument('--app-only', action='store_true', help='leave out the tests of this repo\'s own dev tooling (DEV_TOOLING)')
    parser.add_argument('--jobs', type=int, default=int(os.environ.get('JOB_PILOTTO_PY_JOBS', 0)) or min(4, os.cpu_count() or 2))
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
