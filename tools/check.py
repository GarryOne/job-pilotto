"""Run consistent fast, area or full project verification with supported runtimes and actionable failures."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import tempfile

ROOT = Path(__file__).resolve().parents[1]
AREAS = ('python', 'worker', 'site', 'desktop')


def node_supported(version):
    parts = tuple(int(part) for part in version.strip().lstrip('v').split('.')[:3])
    return (parts[0] == 22 and parts >= (22, 13, 0)) or parts[0] >= 24


def find_node(env=None):
    env = os.environ if env is None else env
    candidates = [env.get('JOB_PILOTTO_CHECK_NODE'), shutil.which('node')]
    nvm = Path(env.get('NVM_DIR', str(Path.home() / '.nvm'))) / 'versions/node'
    if nvm.exists():
        candidates += [str(path / 'bin/node') for path in sorted(nvm.glob('v*'), reverse=True)]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            version = subprocess.check_output([candidate, '--version'], text=True, stderr=subprocess.DEVNULL)
            if node_supported(version):
                return str(Path(candidate).resolve()), version.strip()
        except (OSError, ValueError, subprocess.CalledProcessError):
            continue
    raise RuntimeError('Node 22.13+ or 24+ is required. Use nvm use 22 or set JOB_PILOTTO_CHECK_NODE.')


def commands(area, fast, node, npm):
    if area == 'python':
        return [(ROOT, [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-q'])]
    folder = ROOT / area
    if fast and area == 'desktop':
        return [(folder, [node, 'scripts/stage.mjs']),
                (folder, [npm, 'run', 'lint']),
                (folder, [node, '--test', 'test/lifecycle.test.js', 'test/session-contracts.test.js', 'test/ipc.test.js', 'test/codemap.test.js'])]
    return [(folder, [npm, 'test'])]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--area', choices=AREAS, action='append', help='repeat to select suites; default: all')
    parser.add_argument('--fast', action='store_true', help='desktop lint and focused lifecycle/contract checks (default area: desktop)')
    parser.add_argument('--clean-install', action='store_true', help='verify desktop/Worker/site lockfiles in temporary folders before checks')
    args = parser.parse_args(argv)
    areas = args.area or (['desktop'] if args.fast else list(AREAS))
    if sys.version_info < (3, 12):
        print('check: Python 3.12+ is required.', file=sys.stderr)
        return 2
    env = dict(os.environ)
    env['JOB_PILOTTO_DISABLE'] = 'mail,notion,telegram,google_jobs'
    node = npm = None
    try:
        if args.clean_install or any(area != 'python' for area in areas):
            node, version = find_node()
            env['PATH'] = str(Path(node).parent) + os.pathsep + env.get('PATH', '')
            npm = shutil.which('npm', path=env['PATH'])
            if not npm:
                raise RuntimeError('npm is missing beside the supported Node runtime.')
            print(f'check: Node {version}', flush=True)
        print(f'check: Python {sys.version.split()[0]}', flush=True)
        for area in areas:
            package = json.loads((ROOT / area / 'package.json').read_text()) if area != 'python' else {}
            needs_modules = bool(package.get('dependencies') or package.get('devDependencies'))
            if needs_modules and not (ROOT / area / 'node_modules').is_dir():
                raise RuntimeError(f'{area}/node_modules is missing. Use tools/worktree.sh or run npm ci in {area}/.')
            if area == 'desktop' and not (ROOT / 'desktop/node_modules/eslint').exists():
                raise RuntimeError('Desktop dependencies are outdated: run npm ci in desktop/.')
    except RuntimeError as error:
        print(f'check: {error}', file=sys.stderr)
        return 2
    if args.clean_install:
        for area in ('desktop', 'worker', 'site'):
            folder = ROOT / area
            with tempfile.TemporaryDirectory(prefix='job-pilotto-check-') as scratch:
                for name in ('package.json', 'package-lock.json'):
                    shutil.copyfile(folder / name, Path(scratch) / name)
                print(f'check: {area} clean npm ci', flush=True)
                result = subprocess.run([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=scratch, env=env, check=False)
                if result.returncode:
                    print(f'check: {area} clean install failed', file=sys.stderr)
                    return 1
    failed = []
    for area in dict.fromkeys(areas):
        started = time.monotonic()
        print(f'check: {area} started', flush=True)
        for folder, command in commands(area, args.fast, node, npm):
            try:
                result = subprocess.run(command, cwd=folder, env=env, check=False)
            except OSError as error:
                print(f'check: could not launch {area}: {error}', file=sys.stderr)
                failed.append(area)
                break
            if result.returncode:
                failed.append(area)
                break
        print(f'check: {area} {"FAILED" if area in failed else "passed"} ({time.monotonic() - started:.1f}s)', flush=True)
    if failed:
        print('check: reproduce with tools/check.sh ' + ' '.join(f'--area {area}' for area in failed), file=sys.stderr)
        return 1
    print('check: all selected checks passed', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
