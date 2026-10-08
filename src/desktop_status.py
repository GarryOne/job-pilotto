"""The desktop app's application status writes: set_status() and delete_job() with the Notion Stage first (a pure move out of desktop.py).

Guarded by tests/test_desktop.py and tests/test_import_url.py.
"""
from . import store
from .desktop_jobs import stage_status


NOTION_STAGES = {'saved': 'Saved', 'applied': 'Applied', 'dismissed': 'Dismissed'}


class InProcess(Exception):
    pass


def _mark(tracker, job, status):
    """Write the status as an Applications stage. Returns (outcome, stage now in Notion, or None when it is not known).
    Notion keeps a real application stage (Interview scheduled, Applied...) against Saved/Dismissed (a Telegram misfire
    must not close an application), so a Dismiss the person clicked here closes the job instead; Saved on one is
    refused: telling the person it worked while Notion kept its stage is what made a dismissed interview come back."""
    page, outcome = tracker.mark(job, NOTION_STAGES[status])
    current = (((page or {}).get('properties') or {}).get('Stage', {}).get('select') or {}).get('name')
    if outcome != 'unchanged' or not current or current == NOTION_STAGES[status] or stage_status(current) != 'applied':
        return outcome, NOTION_STAGES[status] if outcome != 'unchanged' else current
    if status == 'dismissed':
        _, outcome = tracker.mark(job, 'Closed')
        return outcome, 'Closed'
    raise InProcess(f'It is already in process ({current}), so it can not be saved. Dismiss it to close it.')


def set_status(db, url, status, tracker=None):
    """Record the status locally and, with Notion connected, as the job's Applications stage (the source
    of truth; Saved/Dismissed never overwrite a real application stage, see Tracker.mark)."""
    row = db.execute("""SELECT jobs.id, jobs.title, jobs.url, jobs.location, jobs.posted_at, jobs.first_seen_at,
                                 companies.name company FROM jobs JOIN companies ON companies.id=jobs.company_id
                          WHERE jobs.url=?""", (url,)).fetchone()
    if not row and tracker and status in NOTION_STAGES:  # a job only in Notion (no local copy): Notion alone
        item = next((j for j in tracker.notion_jobs() if j['url'] == url), None)
        if not item:
            return {'ok': False, 'error': 'job not found'}
        try:
            outcome, stage = _mark(tracker, {'title': item['title'], 'company': item['company'], 'location': item['location'],
                                             'url': url, 'posted_at': '', 'first_seen_at': item.get('first_seen', '')}, status)
        except InProcess as error:
            return {'ok': False, 'error': str(error)}
        except Exception as error:  # noqa: BLE001
            return {'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing changed. Try again.'}
        return {'ok': True, 'notion': outcome, 'stage': stage}
    if not row:
        return {'ok': False, 'error': 'job not found'}
    outcome = stage = None
    if tracker and status in NOTION_STAGES:  # Notion first: if it can't be written, nothing changes
        try:
            outcome, stage = _mark(tracker, dict(row), status)
        except InProcess as error:
            return {'ok': False, 'error': str(error)}
        except Exception as error:  # noqa: BLE001 — shown to the user; the local cache stays as it was
            return {'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing changed. Try again.'}
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
