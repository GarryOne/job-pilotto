"""A search's scored jobs into a store's Matches, for the stores without a sync of their own (memory, sqlite): the same rows
and statuses src/notion/matches.py writes to 🎯 Job Matches, as store records (base.MATCH_FIELDS).

One row per job (base.url_key): the best scored copy of a job is written; a job applied to is Applied, else Open. After a full
search (not `partial`), a row the search no longer has becomes Dismissed, Applied, or Not seen when the crawl's open jobs lack
it (not proof the posting closed). Unchanged rows are not written. The scoring columns only Notion keeps (tier, confidence,
languages...) stay in the search's own cache. Guarded by tests/store_contract.py (every store, Notion's through its own sync).
"""
from . import base

MODES = {'onsite': 'On-site', 'hybrid': 'Hybrid', 'remote': 'Remote'}   # as src/notion/matches.py writes Work mode
PARTS = ('role_fit', 'location', 'compensation', 'growth', 'risk')


def record(job, status):
    """The store record for one scored job (it carries 'fit', and 'ai' once read)."""
    fit, ai = job['fit'], job.get('ai') or {}
    mode = ((ai.get('work_mode') or {}).get('value')) if ai else None
    found = {'url': job['url'].strip(), 'title': job.get('title') or '', 'company': job.get('company') or '',
             'location': job.get('location') or '', 'work_mode': MODES.get(mode, ''), 'fit': fit['score'],
             'reason': fit.get('reason') or '', 'status': status,
             'fit_detail': {'strengths': '; '.join(fit.get('strengths', [])), 'gaps': '; '.join(fit.get('gaps', [])),
                            'parts': {part: (fit.get('components') or {}).get(part) for part in PARTS}}}
    if job.get('first_seen_at'):
        found['first_seen'] = job['first_seen_at'][:10]
    return found


def _same(row, wanted):
    return all(row.get(field) == value for field, value in wanted.items())


def sync(matches, scored_jobs, applied_urls=frozenset(), open_urls=None, dismissed_urls=frozenset(), partial=False):
    """Write changed rows into `matches` (a store's Matches); returns the same summary line as the Notion sync."""
    best = {}
    for job in scored_jobs:
        key = base.url_key(job['url'])
        if key not in best or job['fit']['score'] > best[key]['fit']['score']:
            best[key] = job
    applied, dismissed = {base.url_key(u) for u in applied_urls}, {base.url_key(u) for u in dismissed_urls}
    rows = {base.url_key(row['url']): row for row in matches.list()}
    created = updated = 0
    for key, job in best.items():
        wanted = record(job, 'Applied' if key in applied else 'Open')
        row = rows.get(key)
        if row and _same(row, {k: v for k, v in wanted.items() if k not in ('url', 'first_seen')}):
            continue
        matches.upsert(wanted if not row else {k: v for k, v in wanted.items() if k != 'first_seen'})
        created, updated = (created + 1, updated) if not row else (created, updated + 1)
    if partial:
        return f'Job Matches: {created} created, {updated} updated'
    open_keys = None if open_urls is None else {base.url_key(u) for u in open_urls}
    for key, row in rows.items():
        if key in best:
            continue
        status = ('Dismissed' if key in dismissed else 'Applied' if key in applied
                  else 'Not seen' if open_keys is None or key not in open_keys else None)
        if status and row['status'] != status:
            matches.set_status(row['url'], status)
            updated += 1
    return f'Job Matches: {created} created, {updated} updated'
