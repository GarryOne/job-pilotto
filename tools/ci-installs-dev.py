"""Pre-push gate: build.yml's TEST jobs install dev dependencies like a developer does (d5a5820, 28 Sep 2026: desktop's pretest needs esbuild).
Prints each `npm ci/install --omit/--only dev|prod` or `--production` line outside the one step that installs the app's runtime packages on purpose
(id: replay-install: the replays run on the app's own dependencies); exit 1 if any. Usage: ci-installs-dev.py [build.yml]. Guard: tests/test_ci_installs_dev.py."""
import re
import sys

EXEMPT_STEP_ID = 'replay-install'
BAD = re.compile(r'npm (ci|install)[^#]*--(omit|only)[= ](dev|prod)|--production')


def offending(text):
    """(line number, line) of every install without dev dependencies outside the exempt step."""
    found, exempt = [], False
    for number, line in enumerate(text.splitlines(), 1):
        if re.match(r'\s*- (name|uses|id):', line):   # a new step starts
            exempt = False
        if re.match(r'\s*(- )?id:\s*' + EXEMPT_STEP_ID + r'\s*$', line):
            exempt = True
        if BAD.search(line) and not exempt:
            found.append((number, line.strip()))
    return found


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else '.github/workflows/build.yml'
    try:
        bad = offending(open(path, encoding='utf-8').read())
    except FileNotFoundError:
        sys.exit(0)   # a checkout without the workflow has nothing to check
    for number, line in bad:
        print(f'{path}:{number}: {line}')
    if bad:
        print(f'{path}: the test jobs must install dev dependencies like a developer does (drop --omit/--production); only the step with id: {EXEMPT_STEP_ID} may')
        sys.exit(1)
