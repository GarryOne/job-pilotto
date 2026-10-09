"""The SQLite store: the user's data on this Mac, the default adapter when Notion isn't chosen.

One file, data/tracker.sqlite (the user's records; data/jobs.sqlite stays a rebuildable crawl cache), files under
data/files/<app_id>/, texts as Markdown files (the desktop app's JOB_PILOTTO_PROFILE_FILE / _ANSWERS_FILE /
_KNOWLEDGE_FILE when set, else data/texts/<name>.md). Each table keeps the whole record as JSON in `data` (so an int
stays an int and a list a list) plus the few columns it is looked up or ordered by. Spec: docs/superpowers/specs/2026-10-09-store-adapters.md.
Guarded by tests/test_store_sqlite.py (the contract suite plus what is SQLite's own: reopening, the file layout).
"""
import json
import os
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import base

# PRAGMA user_version: add a step to MIGRATIONS (never edit a shipped one) when the layout changes.
MIGRATIONS = (
    """
    CREATE TABLE applications (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, url_key TEXT NOT NULL UNIQUE,
                               stage TEXT NOT NULL DEFAULT '', data TEXT NOT NULL);
    CREATE TABLE sections (app_id TEXT NOT NULL, name TEXT NOT NULL, markdown TEXT NOT NULL, PRIMARY KEY (app_id, name));
    CREATE TABLE files (seq INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT NOT NULL, name TEXT NOT NULL,
                        content_type TEXT NOT NULL DEFAULT '', UNIQUE (app_id, name));
    CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, app_id TEXT NOT NULL DEFAULT '',
                         kind TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
                         data TEXT NOT NULL);
    CREATE INDEX events_app_idx ON events(app_id);
    CREATE INDEX events_source_idx ON events(source_id);
    CREATE TABLE matches (seq INTEGER PRIMARY KEY AUTOINCREMENT, url_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT '',
                          data TEXT NOT NULL);
    CREATE TABLE interviews (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, app_id TEXT NOT NULL DEFAULT '',
                             archived INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
    CREATE TABLE insights (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, day TEXT NOT NULL,
                           category TEXT NOT NULL, data TEXT NOT NULL, UNIQUE (day, category));
    CREATE TABLE employers (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, name_key TEXT NOT NULL UNIQUE,
                            active INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
    CREATE TABLE agent_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, ats TEXT NOT NULL DEFAULT '',
                             data TEXT NOT NULL);
    CREATE TABLE cron_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT '',
                            started_at TEXT NOT NULL DEFAULT '', data TEXT NOT NULL);
    """,
)


def connect(path):
    """The tracker database at `path`, created or migrated to the latest layout."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # The engine and the desktop app may both have it open: WAL lets one read while the other writes.
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    version = db.execute('PRAGMA user_version').fetchone()[0]
    for number, script in enumerate(MIGRATIONS[version:], start=version + 1):
        with db:
            db.executescript(f'BEGIN; {script}; PRAGMA user_version = {number}; COMMIT;')
    return db


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _known(fields, values):
    unknown = set(values) - set(fields)
    if unknown:
        raise KeyError(f'not a field: {", ".join(sorted(unknown))}')
    return values


class _Table:
    """A table of records with an `id`: `columns(record)` gives the looked-up columns kept beside `data`."""
    table, fields, live = '', (), ''

    def __init__(self, db):
        self.db = db

    def columns(self, row):
        return {}

    def _rows(self, where='', args=(), order='seq', limit=None):
        clauses = [c for c in (self.live, where) if c]
        sql = f'SELECT data FROM {self.table}' + (f' WHERE {" AND ".join(clauses)}' if clauses else '') + f' ORDER BY {order}'
        if limit:
            sql += f' LIMIT {int(limit)}'
        return [base.record(self.fields, json.loads(r['data'])) for r in self.db.execute(sql, args)]

    def _get(self, row_id):
        found = self.db.execute(f'SELECT data FROM {self.table} WHERE id = ?', (row_id,)).fetchone()
        if not found:
            raise KeyError(row_id)
        return base.record(self.fields, json.loads(found['data']))

    def _write(self, row):
        cols = {'id': row['id'], **self.columns(row), 'data': json.dumps(row, ensure_ascii=False)}
        names = ', '.join(cols)
        updates = ', '.join(f'{n} = excluded.{n}' for n in cols if n != 'id')
        with self.db:
            self.db.execute(f'INSERT INTO {self.table} ({names}) VALUES ({", ".join("?" * len(cols))}) '
                            f'ON CONFLICT(id) DO UPDATE SET {updates}', tuple(cols.values()))
        return dict(row)

    def _new(self, values):
        return self._write(base.record(self.fields, {**values, 'id': uuid.uuid4().hex, 'created_at': _now()}))

    def put(self, record):
        """A record copied from another store, as it is (its dates too), under a new id: only the move calls it."""
        values = _known(self.fields, dict(record))
        return self._write(base.record(self.fields, {**values, 'id': uuid.uuid4().hex,
                                                     'created_at': values.get('created_at') or _now()}))

    def _update(self, row_id, fields):
        row = self._get(row_id)
        row.update(_known(self.fields, {k: v for k, v in fields.items() if k not in ('id', 'created_at')}))
        return self._write(row)


class Applications(_Table):
    table, fields = 'applications', base.APPLICATION_FIELDS

    def __init__(self, db, files):
        super().__init__(db)
        self.file_root = files

    def columns(self, row):
        return {'url_key': base.url_key(row['url']), 'stage': row['stage'] or ''}

    def update(self, app_id, fields):
        return self._update(app_id, fields)

    def list(self, stages=None):
        if stages is None:
            return self._rows()
        stages = list(stages)
        return self._rows(f'stage IN ({", ".join("?" * len(stages))})', stages) if stages else []

    def get(self, url):
        found = self._rows('url_key = ?', (base.url_key(url),))
        return found[0] if found else None

    def stages(self):
        return {r['url_key']: r['stage'] for r in self.db.execute('SELECT url_key, stage FROM applications')}

    def create(self, job, stage):
        found = self.get(job.get('url'))
        if found:
            return self._update(found['id'], {'stage': stage})
        return self._new({**_known(self.fields, job), 'stage': stage})

    def set_stage(self, job, stage, today=None):
        found = self.get(job.get('url'))
        if found and found['stage'] == stage:
            return found, base.UNCHANGED
        stamp = {'applied_on': today or _now()[:10]} if stage == 'Applied' and not (found or {}).get('applied_on') else {}
        if found:
            return self._update(found['id'], {'stage': stage, **stamp}), base.CHANGED
        return self.create({**job, **stamp}, stage), base.CREATED

    def delete(self, app_id):
        with self.db:
            self.db.execute('DELETE FROM sections WHERE app_id = ?', (app_id,))
            self.db.execute('DELETE FROM files WHERE app_id = ?', (app_id,))
            self.db.execute('DELETE FROM applications WHERE id = ?', (app_id,))
        shutil.rmtree(self._folder(app_id), ignore_errors=True)

    def section(self, app_id, name):
        found = self.db.execute('SELECT markdown FROM sections WHERE app_id = ? AND name = ?', (app_id, name)).fetchone()
        return found['markdown'] if found else None

    def set_section(self, app_id, name, markdown):
        self._get(app_id)
        with self.db:
            self.db.execute('INSERT INTO sections (app_id, name, markdown) VALUES (?, ?, ?) '
                            'ON CONFLICT(app_id, name) DO UPDATE SET markdown = excluded.markdown', (app_id, name, markdown))

    def _folder(self, app_id):
        return self.file_root / Path(app_id).name

    def attach(self, app_id, name, data, content_type):
        """Keeps the bytes under data/files/<app_id>/<name> and returns that path (no FILES capability)."""
        self._get(app_id)
        path = self._folder(app_id) / (Path(name).name or 'file')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(bytes(data))
        with self.db:
            self.db.execute('INSERT INTO files (app_id, name, content_type) VALUES (?, ?, ?) ON CONFLICT(app_id, name) '
                            'DO UPDATE SET content_type = excluded.content_type', (app_id, path.name, content_type or ''))
        return str(path)

    def sections(self, app_id):
        return {r['name']: r['markdown'] for r in
                self.db.execute('SELECT name, markdown FROM sections WHERE app_id = ? ORDER BY rowid', (app_id,))}

    def files(self, app_id):
        """[(name, bytes, content_type)] of the job's files still on disk."""
        found = self.db.execute('SELECT name, content_type FROM files WHERE app_id = ? ORDER BY seq', (app_id,))
        folder = self._folder(app_id)
        return [(r['name'], (folder / r['name']).read_bytes(), r['content_type']) for r in found
                if (folder / r['name']).is_file()]


class Events(_Table):
    table, fields, live = 'events', base.EVENT_FIELDS, 'archived = 0'

    def columns(self, row):
        return {'app_id': row['app_id'] or '', 'kind': row['kind'] or '', 'source_id': row['source_id'] or ''}

    def list(self, app_id=None, kind=None, source_id=None):
        wanted = {k: v for k, v in (('app_id', app_id), ('kind', kind), ('source_id', source_id)) if v is not None}
        return self._rows(' AND '.join(f'{k} = ?' for k in wanted), tuple(wanted.values()))

    def add(self, app_id, kind, at, **fields):
        same = fields.get('source_id') and self.list(app_id=app_id, source_id=fields['source_id'])
        if same:
            return same[0]
        return self._new({**_known(self.fields, fields), 'app_id': app_id, 'kind': kind, 'at': at})

    def archive(self, app_id, kind):
        with self.db:
            return self.db.execute('UPDATE events SET archived = 1 WHERE archived = 0 AND app_id = ? AND kind = ?',
                                   (app_id, kind)).rowcount


class Matches:
    fields = base.MATCH_FIELDS

    def __init__(self, db):
        self.db = db

    def _one(self, key):
        found = self.db.execute('SELECT data FROM matches WHERE url_key = ?', (key,)).fetchone()
        return base.record(self.fields, json.loads(found['data'])) if found else None

    def _write(self, key, row):
        with self.db:
            self.db.execute('INSERT INTO matches (url_key, status, data) VALUES (?, ?, ?) ON CONFLICT(url_key) DO UPDATE '
                            'SET status = excluded.status, data = excluded.data',
                            (key, row['status'] or '', json.dumps(row, ensure_ascii=False)))
        return dict(row)

    def list(self, status=None):
        sql, args = ('SELECT data FROM matches ORDER BY seq', ()) if status is None else \
            ('SELECT data FROM matches WHERE status = ? ORDER BY seq', (status,))
        return [base.record(self.fields, json.loads(r['data'])) for r in self.db.execute(sql, args)]

    def upsert(self, job):
        key = base.url_key(job['url'])
        row = self._one(key) or base.record(self.fields, {'first_seen': _now()})
        row.update(_known(self.fields, job))
        return self._write(key, row)

    def set_status(self, url, status):
        key = base.url_key(url)
        row = self._one(key)
        if row is None:
            raise KeyError(url)
        self._write(key, {**row, 'status': status})

    def remove(self, url):
        with self.db:
            self.db.execute('DELETE FROM matches WHERE url_key = ?', (base.url_key(url),))


class Interviews(_Table):
    table, fields, live = 'interviews', base.INTERVIEW_FIELDS, 'archived = 0'

    def columns(self, row):
        return {'app_id': row['app_id'] or ''}

    def list(self, app_id=None):
        return self._rows() if app_id is None else self._rows('app_id = ?', (app_id,))

    def get(self, interview_id):
        found = self._rows('id = ?', (interview_id,))
        return found[0] if found else None

    def save(self, interview_id, fields):
        if interview_id:
            return self._update(interview_id, fields)
        return self._new(_known(self.fields, fields))

    def archive(self, interview_id):
        with self.db:
            self.db.execute('UPDATE interviews SET archived = 1 WHERE id = ?', (interview_id,))


class Insights(_Table):
    table, fields = 'insights', base.INSIGHT_FIELDS

    def columns(self, row):
        return {'day': row['day'], 'category': row['category']}

    def list(self, since=None, category=None, limit=None):
        wanted = [(c, v) for c, v in (('day >= ?', since), ('category = ?', category)) if v is not None]
        return self._rows(' AND '.join(c for c, _ in wanted), tuple(v for _, v in wanted), 'day DESC, seq DESC', limit)

    def save(self, day, category, title, body, fields=None):
        values = {'day': day, 'category': category, 'title': title, 'body': body, 'fields': dict(fields or {})}
        same = self.db.execute('SELECT id FROM insights WHERE day = ? AND category = ?', (day, category)).fetchone()
        return self._update(same['id'], values) if same else self._new(values)


class Employers(_Table):
    table, fields = 'employers', base.EMPLOYER_FIELDS

    def columns(self, row):
        return {'name_key': row['name'].casefold(), 'active': 1 if row['active'] else 0}

    def list(self, active=True):
        return self._rows() if active is None else self._rows('active = ?', (1 if active else 0,))

    def add(self, employer):
        same = self.db.execute('SELECT id FROM employers WHERE name_key = ?', (employer['name'].casefold(),)).fetchone()
        if same:
            return self._get(same['id'])
        return self._new({'active': True, **_known(self.fields, employer)})


class AgentRuns(_Table):
    table, fields = 'agent_runs', base.AGENT_RUN_FIELDS

    def columns(self, row):
        return {'ats': row['ats'] or ''}

    def add(self, run):
        return self._new(_known(self.fields, run))

    def update(self, run_id, fields):
        return self._update(run_id, fields)

    def list(self, ats=None, limit=None):
        return self._rows(*(('ats = ?', (ats,)) if ats is not None else ('', ())), order='seq DESC', limit=limit)


class CronRuns(_Table):
    table, fields = 'cron_runs', base.CRON_RUN_FIELDS

    def columns(self, row):
        return {'kind': row['kind'] or '', 'started_at': row['started_at'] or ''}

    def begin(self, kind, where):
        return self._write(base.record(self.fields, {'id': uuid.uuid4().hex, 'kind': kind, 'where': where,
                                                     'status': 'Running', 'started_at': _now(), 'progress': []}))

    def progress(self, run_id, line):
        row = self._get(run_id)
        self._write({**row, 'progress': [*(row['progress'] or []), line]})

    def finish(self, run_id, status, summary='', report='', result='', log=''):
        return self._update(run_id, {'status': status, 'summary': summary, 'report': report, 'result': result,
                                    'log': log, 'finished_at': _now()})

    def get(self, run_id):
        found = self._rows('id = ?', (run_id,))
        return found[0] if found else None

    def list(self, since=None, kind=None):
        wanted = [(c, v) for c, v in (('started_at >= ?', since), ('kind = ?', kind)) if v is not None]
        return self._rows(' AND '.join(c for c, _ in wanted), tuple(v for _, v in wanted), 'seq DESC')


class Texts:
    """Whole Markdown files: the app's Profile and standard answers where it keeps them, else data/texts/<name>.md."""
    VARIABLES = {'profile': 'JOB_PILOTTO_PROFILE_FILE', 'answers': 'JOB_PILOTTO_ANSWERS_FILE',
                 'knowledge': 'JOB_PILOTTO_KNOWLEDGE_FILE'}

    def __init__(self, folder, env):
        self.folder, self.env = Path(folder), env

    def path(self, name):
        if name not in base.TEXTS:
            raise KeyError(name)
        return Path(self.env.get(self.VARIABLES.get(name, '')) or self.folder / f'{name}.md')

    def get(self, name):
        path = self.path(name)
        return path.read_text(encoding='utf-8') if path.is_file() else ''

    def set(self, name, markdown):
        path = self.path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(markdown, encoding='utf-8')


def root(env):
    """The data folder: JOB_PILOTTO_DATA_DIR (the app's, a test's temp folder) when set, else the engine's data/."""
    from .. import paths
    return Path(env.get('JOB_PILOTTO_DATA_DIR') or paths.DATA)


def open_store(env=None):
    env = os.environ if env is None else env
    folder = root(env)
    db = connect(folder / 'tracker.sqlite')
    return base.Stores(name='sqlite', applications=Applications(db, folder / 'files'), events=Events(db),
                       matches=Matches(db), interviews=Interviews(db), insights=Insights(db), employers=Employers(db),
                       agent_runs=AgentRuns(db), cron_runs=CronRuns(db), texts=Texts(folder / 'texts', env))
