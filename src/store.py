#!/usr/bin/env python3
"""Canonical local store for jobs, companies, sources and application state."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

from .sources.feeds import excluded_title


SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    website TEXT,
    careers_url TEXT,
    size TEXT,
    verification TEXT NOT NULL DEFAULT 'unknown',
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    url TEXT,
    kind TEXT NOT NULL DEFAULT 'unknown',
    last_status TEXT,
    last_checked_at TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    canonical_key TEXT NOT NULL UNIQUE,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    location TEXT,
    city TEXT,
    work_mode TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    classification TEXT,
    confidence REAL,
    salary_json TEXT,
    notes TEXT
);
CREATE TABLE IF NOT EXISTS applications (
    job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
    status TEXT NOT NULL DEFAULT 'unreviewed',
    updated_at TEXT NOT NULL,
    notes TEXT
);
CREATE INDEX IF NOT EXISTS jobs_city_idx ON jobs(city);
CREATE INDEX IF NOT EXISTS jobs_state_idx ON jobs(state);
"""


def connect(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    # Databases restored from older runs predate these columns.
    columns = {row['name'] for row in db.execute("PRAGMA table_info(jobs)")}
    if 'posted_at' not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN posted_at TEXT")
    if 'description' not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN description TEXT")
    return db


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _id(db, table, name, values):
    row = db.execute(f"SELECT id FROM {table} WHERE name=?", (name,)).fetchone()
    if row:
        return row['id']
    cur = db.execute(f"INSERT INTO {table} (name, {', '.join(values)}) VALUES (?, {', '.join('?' for _ in values)})",
                     (name, *values.values()))
    return cur.lastrowid


def added_source_ids(db):
    """Source ids of jobs you added yourself (src/ai/added.py, kind 'you'): tracked on Applications only, never
    mirrored into Job Matches, which holds what a search found."""
    return {row['id'] for row in db.execute("SELECT id FROM sources WHERE kind='you'")}


def upsert_job(db, item, source_name, source_url='', source_kind='job board', now=None):
    now = now or _now()
    company_name = item.get('company') or 'Unknown employer'
    source_id = _id(db, 'sources', source_name, {'url': source_url, 'kind': source_kind})
    company_id = _id(db, 'companies', company_name, {'updated_at': now})
    db.execute("UPDATE sources SET url=COALESCE(NULLIF(?, ''), url), kind=?, last_checked_at=?, last_status='ok' WHERE id=?",
               (source_url, source_kind, now, source_id))
    db.execute("UPDATE companies SET updated_at=? WHERE id=?", (now, company_id))
    # Prefer the canonical application URL so the same job discovered through
    # a board and an employer feed can converge to one record.
    key = f"url:{item.get('url')}" if item.get('url') else f"{source_name}:{item.get('id')}"
    existing = db.execute("SELECT id, first_seen_at FROM jobs WHERE canonical_key=?", (key,)).fetchone()
    fields = (source_id, company_id, item.get('title', 'Untitled'), item.get('url', ''),
              item.get('location', ''), item.get('city', ''), item.get('work_mode', ''), now, now,
              item.get('classification'), item.get('confidence'),
              json.dumps(item.get('salary')) if item.get('salary') is not None else None,
              item.get('notes'))
    if existing:
        db.execute("""UPDATE jobs SET source_id=?, company_id=?, title=?, url=?, location=?, city=?,
            work_mode=?, last_seen_at=?, classification=?, confidence=?, salary_json=?, notes=?, state='open' WHERE id=?""",
                   (*fields[:7], fields[8], fields[9], fields[10], fields[11], fields[12], existing['id']))
        job_id = existing['id']; status = 'seen'
    else:
        cur = db.execute("""INSERT INTO jobs (canonical_key, source_id, company_id, title, url, location, city,
            work_mode, first_seen_at, last_seen_at, classification, confidence, salary_json, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (key, *fields))
        job_id = cur.lastrowid; status = 'new'
    if item.get('date_posted'):
        db.execute("UPDATE jobs SET posted_at=? WHERE id=?", (item['date_posted'], job_id))
    # Only overwrite with real text: a failed detail fetch must not erase a stored description.
    if item.get('description'):
        db.execute("UPDATE jobs SET description=? WHERE id=?", (item['description'], job_id))
    db.execute("INSERT OR IGNORE INTO applications(job_id, status, updated_at) VALUES (?, 'unreviewed', ?)", (job_id, now))
    return job_id, status


def track_applied(db, url, meta, now=None):
    """A job applied to outside Job Pilotto (/add, the app's Applied elsewhere), in the jobs list as Applied.
    A job a search already found keeps its crawled details; only its status changes. Returns the job id."""
    row = db.execute("SELECT id FROM jobs WHERE canonical_key=? OR url=?", (f'url:{url}', url)).fetchone()
    if row:
        job_id = row['id']
    else:
        job_id, _ = upsert_job(db, {'url': url, 'title': meta.get('title') or url, 'company': meta.get('company'),
                                    'location': meta.get('location') or '', 'date_posted': meta.get('date_posted'),
                                    'description': meta.get('description')},
                               'Applied elsewhere', source_url=url, source_kind='manual', now=now)
    set_application_status(db, job_id, 'applied')  # commits
    return job_id


def import_watch_report(db, report):
    statuses = []
    for job in report.get('jobs', []):
        # Employer feeds are their own source; aggregated results (Google Jobs) name theirs.
        _, status = upsert_job(db, job, job.get('source') or job['company'], source_url=job['url'],
                               source_kind=job.get('source_kind', 'employer feed'))
        statuses.append(status)
    db.commit()
    return statuses


def import_company_report(db, report):
    statuses = []
    for company in report.get('companies', []):
        for job in company.get('jobs', []):
            if excluded_title(job.get('title')):
                continue  # e.g. "SAP ABAP Developer" from a "software engineer" search: never worth an AI call
            item = dict(job)
            item['company'] = company.get('company') or item.get('company')
            item['notes'] = '; '.join(company.get('notes', []))
            _, status = upsert_job(db, item, item.get('source', 'discovery'), source_url=item.get('url', ''), source_kind='job board')
            statuses.append(status)
        now = _now()
        db.execute("""UPDATE companies SET website=?, careers_url=?, size=?, verification=?, updated_at=? WHERE name=?""",
                   (company.get('website'), (company.get('career_pages') or [None])[0], company.get('size'),
                    'career_link_found' if company.get('career_pages') else 'needs_research', now, company.get('company')))
    db.commit()
    return statuses


def close_stale(db, days=7, now=None):
    """Close open jobs not seen for `days`; a job seen again is reopened by upsert_job. Returns the count."""
    from datetime import timedelta
    cutoff = ((now or datetime.now(timezone.utc)) - timedelta(days=days)).isoformat(timespec='seconds')
    closed = db.execute("UPDATE jobs SET state='closed' WHERE state='open' AND last_seen_at < ?", (cutoff,)).rowcount
    db.commit()
    return closed


def digest_jobs(db, limit=10, only_new=False):
    query = """SELECT jobs.*, companies.name company, applications.status application_status
               FROM jobs JOIN companies ON companies.id=jobs.company_id
               JOIN applications ON applications.job_id=jobs.id WHERE jobs.state='open'"""
    if only_new:
        query += " AND jobs.first_seen_at=jobs.last_seen_at"
    query += " ORDER BY jobs.last_seen_at DESC LIMIT ?"
    return [dict(row) for row in db.execute(query, (limit,)).fetchall()]


def set_application_status(db, job_id, status, notes=None):
    allowed = {'unreviewed', 'saved', 'dismissed', 'applied', 'interview', 'rejected', 'offer'}
    if status not in allowed:
        raise ValueError(f'Unknown application status: {status}')
    db.execute("UPDATE applications SET status=?, updated_at=?, notes=COALESCE(?, notes) WHERE job_id=?",
               (status, _now(), notes, job_id))
    db.commit()
