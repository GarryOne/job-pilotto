"""`python -m src.stores call <entity> <method> '<json kwargs>'`: one store method, JSON out on stdout.

How the desktop reaches the active store without a second copy of any adapter (desktop/lib/store/*): the store is
the one `open_stores()` picks from the environment (JOB_PILOTTO_STORE). Only data methods: the move (`put`) and
bytes (`attach`, `files`) are refused. Exit 2 on a refused or unknown call, 1 when the method raised (its error as
{"error": ...}). Guarded by tests/test_store_cli.py.
"""
import json
import sys

from . import base, open_stores

ENTITIES = ('applications', 'events', 'matches', 'interviews', 'insights', 'employers', 'agent_runs', 'cron_runs',
            'texts')
REFUSED = {'put', 'attach', 'files'}


def call(stores, entity, method, kwargs):
    if entity not in ENTITIES or method.startswith('_') or method in REFUSED:
        raise PermissionError(f'not callable: {entity}.{method}')
    protocol = getattr(base, ''.join(part.title() for part in entity.split('_')))
    if not hasattr(protocol, method):
        raise PermissionError(f'not callable: {entity}.{method}')
    result = getattr(getattr(stores, entity), method)(**kwargs)
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
