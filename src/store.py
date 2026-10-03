#!/usr/bin/env python3
"""Canonical local store for jobs, companies, sources and application state."""
from datetime import datetime, timezone
import json
import re
from pathlib import Path
import sqlite3

from .notion.dedupe import normalize_url
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
    if 'identity' not in columns:
        db.execute("ALTER TABLE jobs ADD COLUMN identity TEXT")
    db.execute("CREATE INDEX IF NOT EXISTS jobs_identity_idx ON jobs(identity)")
    return db


# ---------- one job, many sources ----------
# The same posting now arrives from the employer's feed, jobs.ch, an aggregator and an alert email, each under its own address. Its identity is
# the company and the title written loosely (no legal form, no gender or workload marks, no punctuation); the city decides only when both
# sides name one. A second source of a known open job is merged into it instead of becoming a second job to list and score.
LEGAL = re.compile(r'\b(ag|sa|gmbh|sagl|ltd|limited|inc|llc|plc|se|bv|nv|ab|oy|as|srl|spa|co|corp|corporation|company|group|holding|schweiz|switzerland|suisse)\b')
MARKS = re.compile(r'\((?:[mwfdhxa]\s*/\s*)+[mwfdhxa]\)|\b[mwfdh]\s*/\s*[mwfdh](?:\s*/\s*[mwfdhx])?\b|\ball genders\b|\d{1,3}\s*(?:-|–|bis)?\s*\d{0,3}\s*%|\(a\)')


def _words(text):
    return ' '.join(re.findall(r'[a-z0-9äöüéèàç+#]+', text))


def identity(company, title):
    """'Acme AG', 'Senior DevOps Engineer (m/w/d) 80-100%' -> 'acme|senior devops engineer'; '' when either is missing."""
    company = _words(LEGAL.sub(' ', (company or '').lower()))
    title = _words(MARKS.sub(' ', (title or '').lower()))
    return f'{company}|{title}' if company and title and company not in ('unknown employer', 'undisclosed employer') else ''


def _site(host):
    """The site a host belongs to (jobs.lever.co and api.lever.co are one site): its last two labels."""
    return '.'.join((host or '').lower().split('.')[-2:])


def _city(text):
    """A place's first part, accents and case removed: 'Zürich, Switzerland' and 'Zurich' are the same city."""
    import unicodedata
    plain = unicodedata.normalize('NFKD', (text or '').lower()).encode('ascii', 'ignore').decode()
    return _words(plain.split(',')[0].split(';')[0].split(' - ')[0])


def same_job(db, item, company_name):
    """The open job this item is another copy of (same identity; same city when both name one; on ANOTHER site), or None.
    Two postings with the same title on one site are two openings (a feed lists each requisition once); copies come from other sites."""
    from urllib.parse import urlsplit
    key = identity(company_name, item.get('title'))
    if not key:
        return None, ''
    city = _city(item.get('city') or item.get('location'))
    host = _site(urlsplit(item.get('url') or '').hostname)
    for row in db.execute("SELECT id, location, city, url FROM jobs WHERE identity = ? AND state = 'open'", (key,)):
        if host and host == _site(urlsplit(row['url'] or '').hostname):
            continue
        other = _city(row['city'] or row['location'])
        if not city or not other or city == other or city in other or other in city:
            return row, key
    return None, key


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
    # The same posting listed twice (tracking parameters, a trailing slash, the host's case) is one job: the key is the normalized URL, the same rule that
    # keeps one Notion row per job. A row stored by an older version under its raw URL is found by that key and moved to the normalized one.
    raw_key = f"url:{item.get('url')}" if item.get('url') else None
    key = f"url:{normalize_url(item.get('url'))}" if item.get('url') else f"{source_name}:{item.get('id')}"
    existing = db.execute("SELECT id, first_seen_at, canonical_key FROM jobs WHERE canonical_key IN (?, ?) ORDER BY canonical_key=? DESC",
                          (key, raw_key or key, key)).fetchone()
    if existing and existing['canonical_key'] != key:
        db.execute("UPDATE jobs SET canonical_key=? WHERE id=?", (key, existing['id']))
    fields = (source_id, company_id, item.get('title', 'Untitled'), item.get('url', ''),
              item.get('location', ''), item.get('city', ''), item.get('work_mode', ''), now, now,
              item.get('classification'), item.get('confidence'),
              json.dumps(item.get('salary')) if item.get('salary') is not None else None,
              item.get('notes'))
    duplicate, key_identity = (None, identity(company_name, item.get('title'))) if existing else same_job(db, item, company_name)
    if duplicate:
        # Another source of a job we already hold: keep the first copy (its address, its Notion row, its score); take this copy's text
        # when the first has none (an alert email's job borrows the employer feed's description, and the other way round), note the source.
        db.execute("UPDATE jobs SET last_seen_at=?, notes=TRIM(COALESCE(notes, '') || ' · also on ' || ?) WHERE id=? AND instr(COALESCE(notes, ''), ?) = 0",
                   (now, source_name, duplicate['id'], f'also on {source_name}'))
        db.execute("UPDATE jobs SET last_seen_at=? WHERE id=?", (now, duplicate['id']))
        if item.get('description'):
            db.execute("UPDATE jobs SET description=? WHERE id=? AND COALESCE(description, '') = ''", (item['description'], duplicate['id']))
        return duplicate['id'], 'seen'
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
    if key_identity:
        db.execute("UPDATE jobs SET identity=? WHERE id=?", (key_identity, job_id))
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
    row = db.execute("SELECT id FROM jobs WHERE canonical_key IN (?, ?) OR url=?", (f'url:{normalize_url(url)}', f'url:{url}', url)).fetchone()
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
