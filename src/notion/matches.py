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
    }
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


def sync(db, tracker, scored_jobs, applied_urls=frozenset(), open_urls=None, dismissed_urls=frozenset()):
    """Write changed rows; returns a one-line summary. Stops quietly on the first API error."""
    db.executescript(SYNC_TABLE)
    known = {row['url']: row for row in db.execute('SELECT url, page_id, data_hash FROM notion_matches')}
    created = updated = 0
    for job in scored_jobs:
        url = job['url'].strip()
        status = 'Applied' if url in applied_urls else 'Open'
        props = properties(job, status)
        digest = _hash(props)
        row = known.get(url)
        if row and row['data_hash'] == digest:
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
