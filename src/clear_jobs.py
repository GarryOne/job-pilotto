"""Settings → "Clear my job list": empties what searches found and scored, keeps everything the person acted on.

Cleared: Job Matches rows and the local job cache (jobs, scores, enrichments, shown marks, notion_matches) of jobs with no application
row and no status of the person's. Kept: applied, saved, in-process and closed jobs (their sections, kits, events), imported jobs and,
by default, the jobs the person dismissed or deleted themselves (`keep_dismissed`; otherwise those come back as new on the next search).
Settings, profile, CVs, places, sources and employers are never touched. A search finds a cleared job again as new: its cache row is gone.
Guarded by tests/test_clear_jobs.py.
"""
from . import store
from .stores import base

ACTED = ('saved', 'applied', 'interview', 'rejected', 'offer')   # local statuses the person set (jobs.sqlite applications.status)
STAGES_DISMISSED = ('Dismissed',)
CACHE_TABLES = ('scores', 'enrichments', 'shown', 'applications')   # keyed by job_id; made by their own modules, so each is checked


def _tables(db):
    return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _kept(db, stores, keep_dismissed):
    """-> (kept url keys, how many of them are the person's own dismissals)."""
    kept, dismissed = set(), set()
    for record in stores.applications.list():
        key = base.url_key(record.get('url'))
        (dismissed if record.get('stage') in STAGES_DISMISSED else kept).add(key)
    marks = ['saved', 'applied', 'interview', 'rejected', 'offer', 'dismissed']
    for row in db.execute(f"""SELECT jobs.url, jobs.state, jobs.notes, COALESCE(applications.status, 'unreviewed') status FROM jobs
                              LEFT JOIN applications ON applications.job_id = jobs.id"""):
        key = base.url_key(row['url'])
        if row['status'] in ACTED or row['notes'] == 'imported':
            kept.add(key)
        elif row['status'] == 'dismissed' or row['state'] == 'deleted':
            dismissed.add(key)
    dismissed -= kept
    return (kept | dismissed if keep_dismissed else kept), len(dismissed)


def plan(db, stores, keep_dismissed=True):
    """What a clear would do, nothing changed -> {clear, keep, dismissed (the person's own, kept or not by keep_dismissed)}."""
    kept, dismissed = _kept(db, stores, keep_dismissed)
    found = {base.url_key(row['url']) for row in db.execute('SELECT url FROM jobs')} | {base.url_key(m['url']) for m in stores.matches.list()}
    return {'clear': len(found - kept), 'keep': len(found & kept), 'dismissed': dismissed}


def clear(db, stores, keep_dismissed=True):
    """The store first (Notion: rows to its trash, restorable there for 30 days; nothing local changes if it refuses), then the cache.
    -> {cleared, kept}."""
    before = plan(db, stores, keep_dismissed)
    kept, _ = _kept(db, stores, keep_dismissed)
    stores.matches.clear(keep_urls=kept)
    if not keep_dismissed:
        for record in stores.applications.list():
            if record.get('stage') in STAGES_DISMISSED:
                stores.applications.delete(record['id'])
    ids = [row['id'] for row in db.execute('SELECT id, url FROM jobs') if base.url_key(row['url']) not in kept]
    tables = _tables(db)
    for table in [name for name in CACHE_TABLES if name in tables]:
        db.executemany(f'DELETE FROM {table} WHERE job_id = ?', [(job_id,) for job_id in ids])
    db.executemany('DELETE FROM jobs WHERE id = ?', [(job_id,) for job_id in ids])
    if 'notion_matches' in tables:
        gone = [(row['url'],) for row in db.execute('SELECT url FROM notion_matches') if base.url_key(row['url']) not in kept]
        db.executemany('DELETE FROM notion_matches WHERE url = ?', gone)   # the page ids of the rows just trashed
    db.commit()
    return {'cleared': before['clear'], 'kept': before['keep']}
