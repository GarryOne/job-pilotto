"""Move the user's data from one store to another ("Move my data to Notion"): every entity, through the interface.

Works for any pair of adapters. Resumable: a journal ({entity: {source id: target id}}) is written after every record,
so a second run after a crash or a lost connection skips what is already there instead of adding it twice. The
source is never changed: the caller switches the active store only after `copy` returned without error, and keeps
the source as an archive (one copy in use, D2/D3 of docs/superpowers/specs/2026-10-09-store-adapters.md).
CLI: `python -m src.stores.copy --to notion [--journal PATH]` (the source is the active store's env with
JOB_PILOTTO_STORE=sqlite). Progress lines on stdout: `moving <entity> <done>/<total>`. Guarded by tests/test_store_copy.py.
"""
import argparse
import json
import os
import sys
from pathlib import Path

from . import base, open_stores

# Order matters: applications first (events and interviews point at them).
WITH_APP = ('events', 'interviews')
PLAIN = ('employers', 'insights', 'agent_runs', 'cron_runs')


class Journal:
    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.seen = json.loads(self.path.read_text()) if self.path and self.path.is_file() else {}

    def target(self, entity, source_id):
        return self.seen.get(entity, {}).get(source_id)

    def note(self, entity, source_id, target_id):
        self.seen.setdefault(entity, {})[source_id] = target_id
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(self.seen))
            tmp.replace(self.path)


def _all(table, entity):
    if entity == 'employers':
        return table.list(active=None)
    return table.list()


def copy(source, target, journal=None, progress=lambda entity, done, total: None):
    """Copy everything in `source` into `target`. Returns {entity: count copied this run}."""
    journal = journal or Journal()
    counts = {}

    for name in base.TEXTS:
        text = source.texts.get(name)
        if text and not journal.target('texts', name):
            target.texts.set(name, text)
            journal.note('texts', name, name)
            counts['texts'] = counts.get('texts', 0) + 1

    apps = source.applications.list()
    for done, app in enumerate(apps, 1):
        if not journal.target('applications', app['id']):
            # By URL too: a crash between put() and the journal line must not copy the job twice.
            copied = target.applications.get(app['url']) or target.applications.put(app)
            for section, markdown in source.applications.sections(app['id']).items():
                target.applications.set_section(copied['id'], section, markdown)
            for name, data, kind in source.applications.files(app['id']):
                target.applications.attach(copied['id'], name, data, kind)
            journal.note('applications', app['id'], copied['id'])
            counts['applications'] = counts.get('applications', 0) + 1
        progress('applications', done, len(apps))

    matches = source.matches.list()
    for done, match in enumerate(matches, 1):
        target.matches.upsert(match)  # keyed by URL: a second run changes nothing
        progress('matches', done, len(matches))
    counts['matches'] = len(matches)

    for entity in WITH_APP + PLAIN:
        rows = _all(getattr(source, entity), entity)
        for done, row in enumerate(rows, 1):
            if not journal.target(entity, row['id']):
                values = dict(row)
                if entity in WITH_APP and values.get('app_id'):
                    values['app_id'] = journal.target('applications', values['app_id']) or ''
                copied = getattr(target, entity).put(values)
                journal.note(entity, row['id'], copied['id'])
                counts[entity] = counts.get(entity, 0) + 1
            progress(entity, done, len(rows))
    return counts


def main(argv=None):
    parser = argparse.ArgumentParser(description='Move the user\'s data from the active store to another.')
    parser.add_argument('--from', dest='source', default='sqlite')
    parser.add_argument('--to', required=True)
    parser.add_argument('--journal', help='resume file (default: data/move-<from>-to-<to>.json)')
    args = parser.parse_args(argv)
    if args.source == args.to:
        parser.error('--from and --to are the same store')
    source = open_stores({**os.environ, 'JOB_PILOTTO_STORE': args.source})
    target = open_stores({**os.environ, 'JOB_PILOTTO_STORE': args.to})
    from ..paths import DATA
    journal = Journal(args.journal or Path(DATA) / f'move-{args.source}-to-{args.to}.json')
    counts = copy(source, target, journal, lambda entity, done, total: print(f'moving {entity} {done}/{total}', flush=True))
    print(json.dumps({'moved': counts}), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
