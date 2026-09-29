#!/usr/bin/env python3
"""Mirror AI-scored jobs into the Notion database "Job Matches — AI Scored".

One row per scored job, keyed by URL. A local table remembers each row's page id
and a hash of what was written, so unchanged rows cost no API calls. Rows are
never deleted: applied jobs flip to Status "Applied", ones the crawl no longer sees to "Not seen"
(which is not proof the posting closed: a filter change or a reset cache can cause it).
"""
from datetime import datetime, timezone
import hashlib
import json

from . import client as notion
from .dedupe import normalize_url, plan

SYNC_TABLE = """
CREATE TABLE IF NOT EXISTS notion_matches (
    url TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    data_hash TEXT NOT NULL
);
"""
SENIORITY = {'junior': 'Junior', 'mid': 'Mid', 'senior': 'Senior', 'staff_principal': 'Staff/Principal',
             'lead_manager': 'Lead/Manager'}
MODES = {'onsite': 'On-site', 'hybrid': 'Hybrid', 'remote': 'Remote'}


def _text(value):
    return {'rich_text': [{'text': {'content': (value or '')[:2000]}}]}


def properties(job, status):
    """Notion properties for one scored job (job carries 'ai' and 'fit')."""
    fit, ai = job['fit'], job.get('ai') or {}
    props = {
        'Job': {'title': [{'text': {'content': job['title'][:2000]}}]},
        'Score': {'number': fit['score']},
        'Tier': {'select': {'name': fit['tier']}},
        'Company': _text(job.get('company')),
        'Location': _text(job.get('location')),
        'Reason': _text(fit.get('reason')),
        'Strengths': _text('; '.join(fit.get('strengths', []))),
        'Gaps': _text('; '.join(fit.get('gaps', []))),
        'Role fit': {'number': fit['components']['role_fit']},
        'Location fit': {'number': fit['components']['location']},
        'Compensation fit': {'number': fit['components']['compensation']},
        'Growth': {'number': fit['components']['growth']},
        'Risk': {'number': fit['components']['risk']},
        'Confidence': {'select': {'name': fit['confidence']}},
        'Job URL': {'url': job['url']},
        'Code': _text(notion.job_code(job['url'])),
        'Status': {'select': {'name': status}},
        'Scored': {'date': {'start': datetime.now(timezone.utc).date().isoformat()}},
        # Scored from the whole Profile before contact/links were left out ("Previous"), or with today's inputs.
        'Scoring method': {'select': {'name': fit.get('method') or 'Current'}},
    }
    if job.get('first_seen_at'):  # when a search first found it: "new this week" and the newest-first sort read this
        props['First seen'] = {'date': {'start': job['first_seen_at'][:10]}}
    if ai:
        if ai['seniority']['value'] in SENIORITY:
            props['Seniority'] = {'select': {'name': SENIORITY[ai['seniority']['value']]}}
        if ai['work_mode']['value'] in MODES:
            props['Work mode'] = {'select': {'name': MODES[ai['work_mode']['value']]}}
        languages = (['English'] if ai['english_is_enough']['value'] == 'yes' else []) + [
            f"{l['language']} +" for l in ai['languages']
            if l['level'] == 'nice_to_have' and l['language'] in ('German', 'French', 'Italian')]
        props['Languages'] = {'multi_select': [{'name': name} for name in languages]}
        props['Salary'] = _text(ai['salary']['text'] if ai['salary']['stated'] else '')
        props['Recruiter'] = {'checkbox': ai['employer_type']['value'] == 'recruiter'}
        props['Technologies'] = _text('; '.join(ai.get('technologies') or []))
        if ai.get('role_family'):
            props['Role family'] = {'select': {'name': ai['role_family']}}
    return props


def _hash(props):
    stable = {k: v for k, v in props.items() if k != 'Scored'}
    return hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _as_written(page_props, keys):
    """A Notion row's current values in the shape properties() writes, for the keys it writes; None when one can't be
    read the same way (then the row is simply rewritten)."""
    plain = lambda items: ''.join(t.get('plain_text') or (t.get('text') or {}).get('content', '') for t in items or [])
    out = {}
    for key in keys:
        prop = (page_props or {}).get(key)
        if prop is None:
            return None
        kind = prop.get('type') or next((k for k in ('title', 'rich_text', 'number', 'select', 'multi_select', 'url',
                                                      'checkbox', 'date') if k in prop), None)
        value = prop.get(kind)
        if kind == 'title':
            out[key] = {'title': [{'text': {'content': plain(value)[:2000]}}]}
        elif kind == 'rich_text':
            out[key] = _text(plain(value))
        elif kind in ('number', 'url', 'checkbox'):
            out[key] = {kind: value}
        elif kind == 'select':
            out[key] = {'select': {'name': value['name']} if value else None}
        elif kind == 'multi_select':
            out[key] = {'multi_select': [{'name': option['name']} for option in value or []]}
        elif kind == 'date':
            out[key] = {'date': {'start': value['start']} if value else None}
        else:
            return None
    return out


def adopt_existing(db, tracker, known):
    """Rows already in Notion that this SQLite doesn't know (its cache was reset): remember their page
    ids so they are updated instead of duplicated, and so stale ones can be marked Not seen. Their current values
    come along ('props'): sync() writes only the rows that differ, so a runner without this SQLite (a new GitHub
    repo, an expired cache) doesn't rewrite every row. Copies of one job (same URL, see dedupe.normalize_url) are merged on the
    way: the fullest row is kept and the others go to Notion's trash. Returns {url: row} for the adopted rows."""
    if not hasattr(tracker, 'query_database'):
        return {}
    pages = tracker.query_database(notion.MATCHES_DATABASE_ID)
    if hasattr(tracker, 'trash_page'):
        for group in plan(pages):
            for page in group['drop']:
                tracker.trash_page(page['id'])
            dropped = {page['id'] for page in group['drop']}
            pages = [page for page in pages if page['id'] not in dropped]
            db.execute('DELETE FROM notion_matches WHERE page_id IN (%s)' % ','.join('?' * len(dropped)), tuple(dropped))
    known_keys = {normalize_url(url) for url in known}
    adopted = {}
    for page in pages:
        url = ((page['properties'].get('Job URL') or {}).get('url') or '').strip()
        if url and normalize_url(url) not in known_keys and url not in adopted:
            adopted[url] = {'url': url, 'page_id': page['id'], 'data_hash': '', 'props': page.get('properties') or {}}
            db.execute('INSERT OR IGNORE INTO notion_matches (url, page_id, data_hash) VALUES (?, ?, ?)',
                       (url, page['id'], ''))
    db.commit()
    return adopted


def sync(db, tracker, scored_jobs, applied_urls=frozenset(), open_urls=None, dismissed_urls=frozenset()):
    """Write changed rows; returns a one-line summary. Stops quietly on the first API error."""
    db.executescript(SYNC_TABLE)
    known = {row['url']: row for row in db.execute('SELECT url, page_id, data_hash FROM notion_matches')}
    keys = {normalize_url(url) for url in known}
    in_notion = {}  # url -> the row's current values in Notion, for rows this SQLite didn't know
    if any(normalize_url(job['url']) not in keys for job in scored_jobs):
        adopted = adopt_existing(db, tracker, known)  # may also merge copies of a job: read the links again
        in_notion = {url: row['props'] for url, row in adopted.items()}
        known = {row['url']: row for row in db.execute('SELECT url, page_id, data_hash FROM notion_matches')}
    created = updated = 0
    by_key = {normalize_url(url): row for url, row in known.items()}
    for job in scored_jobs:
        url = job['url'].strip()
        if url not in known and normalize_url(url) in by_key:  # the same job under another URL form: one link
            old = by_key[normalize_url(url)]
            known.pop(old['url'], None)
            db.execute('DELETE FROM notion_matches WHERE url=?', (old['url'],))
            known[url] = {**old, 'url': url}
        status = 'Applied' if url in applied_urls else 'Open'
        props = properties(job, status)
        digest = _hash(props)
        row = known.get(url)
        if row and row['data_hash'] == digest:
            continue
        if row and not row['data_hash'] and url in in_notion:  # adopted: Notion may already hold exactly this
            current = _as_written(in_notion[url], props.keys())
            if current is not None and _hash(current) == digest:
                db.execute('UPDATE notion_matches SET data_hash=? WHERE url=?', (digest, url))
                db.commit()
                continue
        page_id = tracker.upsert_match(props, row['page_id'] if row else None)
        db.execute('INSERT INTO notion_matches (url, page_id, data_hash) VALUES (?, ?, ?) '
                   'ON CONFLICT(url) DO UPDATE SET page_id=excluded.page_id, data_hash=excluded.data_hash',
                   (url, page_id, digest))
        db.commit()
        created, updated = (created + 1, updated) if not row else (created, updated + 1)
    # Rows whose job is now applied or no longer listed keep their data but change status.
    current = {job['url'].strip() for job in scored_jobs}
    for url, row in known.items():
        if url in current:
            continue
        status = ('Dismissed' if url in dismissed_urls else 'Applied' if url in applied_urls
                  else 'Not seen' if open_urls is None or url not in open_urls else None)
        if not status:
            continue
        marker = f'status:{status}'
        if row['data_hash'] == marker:
            continue
        tracker.upsert_match({'Status': {'select': {'name': status}}}, row['page_id'])
        db.execute('UPDATE notion_matches SET data_hash=? WHERE url=?', (marker, url))
        db.commit()
        updated += 1
    return f'Job Matches: {created} created, {updated} updated'
