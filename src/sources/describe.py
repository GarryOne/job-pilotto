"""Descriptions for jobs that arrived without one.

Some boards list postings without their text (SmartRecruiters), and a job board's detail page can fail on the day a
job is found (jobs.ch). Without a description a job never gets stage 1 facts or a fit score, and nothing tried
again: it sat in the list with "–". Each run fetches the missing ones from the posting itself, newest first, a few
at a time (the importer keeps them: it only ever writes a real description over an empty one).
"""
from datetime import datetime, timedelta, timezone
import re
from urllib.parse import urlsplit

from . import ats, boards

SMARTRECRUITERS = re.compile(r'jobs\.smartrecruiters\.com/([^/?#]+)/(\d+)')


def fetch(url, client=None):
    """The posting's text, from its own API or page; '' when this kind of posting can't be read."""
    match = SMARTRECRUITERS.search(url or '')
    if match:
        return ats.smartrecruiters_detail(match.group(1), match.group(2))
    if (urlsplit(url or '').hostname or '').endswith('jobs.ch'):
        page = (client or boards.Client()).get(url)
        posting = next(boards.walk(boards.Page(page['html']).schemas, 'JobPosting'), {})
        return boards.text(posting.get('description', ''))[:12000]
    return ''


def backfill(db, limit=20, days=14, fetcher=fetch):
    """Fill in up to `limit` open jobs (seen in the last `days`) that have no description. Returns a log line."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec='seconds')
    rows = db.execute("SELECT id, url FROM jobs WHERE state='open' AND coalesce(description, '') = '' AND first_seen_at >= ? "
                      "ORDER BY first_seen_at DESC LIMIT ?", (since, limit)).fetchall()
    filled = failed = gone = 0
    for job_id, url in rows:
        try:
            text = fetcher(url)
        except Exception as error:
            if getattr(error, 'code', None) in (404, 410):  # the posting was taken down: the job is closed, not unscored
                db.execute("UPDATE jobs SET state='closed' WHERE id=?", (job_id,))
                gone += 1
            else:  # one posting failing must not stop the others; it's tried again next run
                failed += 1
            continue
        if text:
            db.execute('UPDATE jobs SET description=? WHERE id=?', (text, job_id))
            filled += 1
    db.commit()
    return (f'Descriptions: {filled} of {len(rows)} missing fetched' + (f', {gone} posting(s) taken down (closed)' if gone else '')
            + (f', {failed} failed' if failed else '')) if rows else ''
