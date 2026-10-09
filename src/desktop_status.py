"""The desktop app's application status writes: set_status() through the store (src/stores: the job's Stage, any store), and
delete_job() with the Notion pages first (it moves to the store with Job Matches).

Guarded by tests/test_desktop.py and tests/test_import_url.py.
"""
from . import store
from .desktop_jobs import stage_status
from .stores import base, rules


NOTION_STAGES = {'saved': 'Saved', 'applied': 'Applied', 'dismissed': 'Dismissed'}


class InProcess(Exception):
    pass


def _failed(stores, error):
    where = 'Notion' if getattr(stores, 'name', '') == 'notion' else 'Your job tracker'
    return {'ok': False, 'error': f'{where} could not be updated ({type(error).__name__}); nothing changed. Try again.'}


def _mark(stores, job, status):
    """Write the status as the job's stage. Returns (outcome, stage now kept, or None when it is not known).
    The store keeps a real application stage (Interview scheduled, Applied...) against Saved/Dismissed (a Telegram misfire
    must not close an application, src/stores/rules.py), so a Dismiss the person clicked here closes the job instead; Saved on
    one is refused: telling the person it worked while the stage stayed is what made a dismissed interview come back."""
    row, outcome = rules.mark(stores, job, NOTION_STAGES[status])
    current = (row or {}).get('stage') or None
    if outcome != 'unchanged' or not current or current == NOTION_STAGES[status] or stage_status(current) != 'applied':
        return outcome, NOTION_STAGES[status] if outcome != 'unchanged' else current
    if status == 'dismissed':
        _, outcome = rules.mark(stores, job, 'Closed')
        return outcome, 'Closed'
    raise InProcess(f'It is already in process ({current}), so it can not be saved. Dismiss it to close it.')


def _match(stores, url):
    """The job's Job Matches record (what a search found), or None."""
    key = base.url_key(url)
    return next((match for match in stores.matches.list() if base.url_key(match['url']) == key), None)


def set_status(db, url, status, stores=None):
    """Record the status as the job's stage in the store (the truth; Saved/Dismissed never overwrite a real application
    stage, src/stores/rules.py), then in the local job cache. If the store can't be written, nothing changes."""
    row = db.execute("""SELECT jobs.id, jobs.title, jobs.url, jobs.location, jobs.posted_at, jobs.first_seen_at,
                                 companies.name company FROM jobs JOIN companies ON companies.id=jobs.company_id
                          WHERE jobs.url=?""", (url,)).fetchone()
    if not row and stores and status in NOTION_STAGES:  # a job only in the store (no local copy): the store alone
        item = stores.applications.get(url) or _match(stores, url)  # a found job's ⭐ Save makes its Applications row
        if not item:
            return {'ok': False, 'error': 'job not found'}
        try:
            outcome, stage = _mark(stores, {'title': item['title'], 'company': item['company'], 'location': item['location'],
                                            'url': url}, status)
        except InProcess as error:
            return {'ok': False, 'error': str(error)}
        except Exception as error:  # noqa: BLE001
            return _failed(stores, error)
        return {'ok': True, 'notion': outcome, 'stage': stage}
    if not row:
        return {'ok': False, 'error': 'job not found'}
    outcome = stage = None
    if stores and status in NOTION_STAGES:  # the store first: if it can't be written, nothing changes
        job = {'title': row['title'], 'company': row['company'], 'location': row['location'], 'url': row['url'],
               'posted': (row['posted_at'] or row['first_seen_at'] or '')[:10]}
        try:
            outcome, stage = _mark(stores, job, status)
        except InProcess as error:
            return {'ok': False, 'error': str(error)}
        except Exception as error:  # noqa: BLE001 — shown to the user; the local cache stays as it was
            return _failed(stores, error)
    store.set_application_status(db, row['id'], 'dismissed' if stage == 'Closed' else status)
    db.commit()
    return {'ok': True, 'notion': outcome, 'stage': stage} if outcome else {'ok': True}


def _matches_rows(db, url):
    """The job's Job Matches page ids kept by the Notion sync ([] before its first sync: the table is the sync's own)."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notion_matches'").fetchone():
        return []
    return db.execute("SELECT page_id FROM notion_matches WHERE url=?", (url,)).fetchall()


def delete_job(db, url, tracker=None):
    """Delete a job you dismissed (owner, 7 Oct 2026: two Anthropic rows a Gmail check had made by itself): its Applications and Job Matches
    pages go to Notion's trash (restorable there for 30 days), and the local copy becomes a marker so no search brings it back. Only a dismissed
    job: anything else is still a job you might act on."""
    row = db.execute("""SELECT jobs.id, COALESCE(applications.status, 'unreviewed') status FROM jobs
                        LEFT JOIN applications ON applications.job_id=jobs.id WHERE jobs.url=?""", (url,)).fetchone()
    found = tracker.find(url) if tracker else None
    stage = ((found or {}).get('properties', {}).get('Stage', {}).get('select') or {}).get('name', '') if found else ''
    if not row and not found:
        return {'ok': False, 'error': 'job not found'}
    if (row and row['status'] != 'dismissed' and not stage) or (stage and stage not in ('Dismissed', 'Closed')):
        return {'ok': False, 'error': 'Dismiss it first: only a dismissed job can be deleted.'}
    trashed = 0
    if tracker:
        try:
            pages = [found['id']] if found else []
            pages += [r['page_id'] for r in _matches_rows(db, url) if r['page_id']]
            for page in pages:
                tracker.trash_page(page)
                trashed += 1
        except Exception as error:  # noqa: BLE001 — shown to the user; nothing local changes
            return {'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing was deleted. Try again.'}
    if row:
        store.delete_job(db, row['id'])
        if _matches_rows(db, url):
            db.execute("DELETE FROM notion_matches WHERE url=?", (url,))
        db.commit()
    return {'ok': True, 'trashed': trashed}
