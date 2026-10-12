"""A fake `gh` for tests/test_ship_pr.py (12 Oct 2026): just the pull-request calls tools/ship-pr.sh makes, kept in the JSON file named by FAKE_GH_STATE.
With auto-merge on and no failing check pending, `gh pr view` merges the PR's branch into origin's main (rebased, like GitHub's rebase merge). Not a test module."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

path = Path(os.environ['FAKE_GH_STATE'])
state = json.loads(path.read_text())
argv = sys.argv[1:]
state.setdefault('calls', []).append(' '.join(argv))


def save():
    path.write_text(json.dumps(state))


def flag(name):
    return argv[argv.index(name) + 1] if name in argv else None


def git(*args, cwd=None):
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def merge():
    work = tempfile.mkdtemp()
    git('clone', '-q', state['origin'], work)
    git('config', 'user.email', 't@example.com', cwd=work); git('config', 'user.name', 'Test', cwd=work)
    git('checkout', '-q', state['head'], cwd=work)
    git('rebase', '-q', 'origin/main', cwd=work)
    git('push', '-q', 'origin', 'HEAD:main', cwd=work)
    git('push', '-q', 'origin', ':' + state['head'], cwd=work)   # delete branch on merge
    state['state'] = 'MERGED'
    state['merge_sha'] = git('rev-parse', 'HEAD', cwd=work)


pending = state.get('fail_check') or state.get('fail_check_once')
if argv[:1] == ['api']:
    print('true' if state.get('auto_merge_allowed') else 'false')
elif argv[:2] == ['pr', 'list']:
    print(json.dumps([{'number': 1}] if state.get('state') == 'OPEN' else []))
elif argv[:2] == ['pr', 'create']:
    state.update(state='OPEN', head=flag('--head'), auto=False)
    print('https://example.test/pull/1')
elif argv[:2] == ['pr', 'merge']:
    state['auto'] = '--auto' in argv
elif argv[:2] == ['pr', 'view']:
    if state.get('auto') and not pending and state.get('state') == 'OPEN':
        merge()
    print(json.dumps({'state': state.get('state', 'OPEN'), 'mergeable': 'MERGEABLE', 'url': 'https://example.test/pull/1',
                      'mergeCommit': {'oid': state['merge_sha']} if state.get('merge_sha') else None}))
elif argv[:2] == ['pr', 'checks']:
    if pending:
        print(json.dumps([{'name': pending['name'], 'bucket': 'fail', 'link': pending['link']}]))
        state.pop('fail_check_once', None)
    else:
        print(json.dumps([{'name': 'python', 'bucket': 'pass', 'link': ''}]))
else:
    print(f'fake gh: unknown call {argv}', file=sys.stderr)
    save()
    sys.exit(1)
save()
