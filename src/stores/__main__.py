"""`python -m src.stores call <entity> <method> '<json kwargs>'`: one store method, JSON out on stdout.

How the desktop reaches the active store without a second copy of any adapter (desktop/lib/store/*): the store is
the one `open_stores()` picks from the environment (JOB_PILOTTO_STORE). Only data methods: the move (`put`) and
writing bytes (`attach`) are refused. `applications files` reads a job's files as base64 ({name, content_type, size,
data}); a file over FILE_CAP (or past TOTAL_CAP for the job) comes with data null and too_large true, so a screen can
say it is there. Exit 2 on a refused or unknown call, 1 when the method raised (its error as {"error": ...}).
Guarded by tests/test_store_cli.py.
"""
import base64
import json
import sys

from . import base, open_stores

ENTITIES = ('applications', 'events', 'matches', 'interviews', 'insights', 'employers', 'agent_runs', 'cron_runs',
            'texts')
REFUSED = {'put', 'attach'}
FILE_CAP = 8 * 1024 * 1024     # one file, before base64
TOTAL_CAP = 24 * 1024 * 1024   # one job's files together


def encoded_files(files):
    """[(name, bytes, content_type)] → JSON-able dicts, the bytes as base64 while they fit the caps."""
    found, total = [], 0
    for name, data, content_type in files:
        size = len(data)
        fits = size <= FILE_CAP and total + size <= TOTAL_CAP
        total += size if fits else 0
        found.append({'name': name, 'content_type': content_type or 'application/octet-stream', 'size': size,
                      'data': base64.b64encode(data).decode('ascii') if fits else None, 'too_large': not fits})
    return found


def call(stores, entity, method, kwargs):
    if entity not in ENTITIES or method.startswith('_') or method in REFUSED:
        raise PermissionError(f'not callable: {entity}.{method}')
    protocol = getattr(base, ''.join(part.title() for part in entity.split('_')))
    if not hasattr(protocol, method):
        raise PermissionError(f'not callable: {entity}.{method}')
    result = getattr(getattr(stores, entity), method)(**kwargs)
    if (entity, method) == ('applications', 'files'):
        return encoded_files(result)
    return list(result) if isinstance(result, tuple) else result


def main(argv=None, out=sys.stdout):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) not in (3, 4) or argv[0] != 'call':
        print(__doc__.splitlines()[0], file=sys.stderr)
        return 2
    _, entity, method, *rest = argv
    try:
        kwargs = json.loads(rest[0]) if rest else {}
        stores = open_stores()
        try:
            result = call(stores, entity, method, kwargs)
        except PermissionError as refused:
            print(json.dumps({'error': str(refused)}), file=out)
            return 2
    except Exception as error:  # the caller shows it; nothing is swallowed
        print(json.dumps({'error': f'{type(error).__name__}: {error}'}), file=out)
        return 1
    print(json.dumps({'result': result}, default=str), file=out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
