#!/usr/bin/env python3
"""JSON commands for the desktop app (desktop/), which runs this package as a local helper.

    python -m src.desktop jobs [--limit 200]     ranked open jobs with fit score and application status
    python -m src.desktop status <URL> <status>  record an application status locally (applied, saved, dismissed)
    python -m src.desktop posting <code>         one job's posting (title, company, description) for CV tailoring

The app sets JOB_PILOTTO_CONFIG_DIR / JOB_PILOTTO_DATA_DIR / JOB_PILOTTO_PROFILE_FILE, so everything
here reads and writes the user's own folder. Output is one JSON document on stdout.
"""
import argparse
import json

from . import digest, store
from .ai import score
from .notion.client import job_code
from .paths import JOBS_DB

STATUSES = ('unreviewed', 'saved', 'applied', 'dismissed')


# Notion Applications Stage -> the app's status. With Notion connected the Stage is the only source of truth;
# the local applications.status column is a cache refreshed from it on every list.
def stage_status(stage):
    if not stage or stage == 'Kit ready':
        return 'unreviewed'
    if stage == 'Saved':
        return 'saved'
    if stage in ('Dismissed', 'Closed'):
        return 'dismissed'
    return 'applied'  # Applying, Applied and everything after it (replies, interviews, rejection, offer)


def jobs(db, limit=200, stages=None, notion=False):
    """Eligible open jobs, best fit first (unscored after scored, then the rule-based rank).

    stages: job URL -> Notion Applications Stage. Kits live in Notion; a job has one when its Stage is Kit ready."""
    stages = stages or {}
    NOT_ELIGIBLE = '⛔ Not eligible: '

    def notion_row(job):  # (Stage, Next step, Notion page URL); tests may pass plain stages
        value = stages.get((job.get('url') or '').strip(), (None, '', ''))
        return (tuple(value) + ('', ''))[:3] if isinstance(value, tuple) else (value, '', '')
    candidates, blocked = digest.eligible_jobs(db)
    fits = score.load(db)
    rows = []
    for job in candidates:
        fit = fits.get(job['id'])
        if notion:  # Notion wins; keep the local cache in step
            truth = stage_status(notion_row(job)[0])
            if truth != (job.get('application_status') or 'unreviewed'):
                store.set_application_status(db, job['id'], truth)
                job = {**job, 'application_status': truth}
        rows.append({
            'id': job['id'], 'code': job_code(job['url']) if job.get('url') else '',
            'title': job['title'], 'company': job['company'], 'location': job.get('location') or '',
            'work_mode': job.get('work_mode') or '', 'url': job.get('url') or '',
            'posted_at': job.get('posted_at') or '', 'first_seen_at': job.get('first_seen_at') or '',
            'status': job.get('application_status') or 'unreviewed',
            'fit': fit.get('score') if fit else None,
            'reason': (fit.get('summary') or fit.get('reason') or '') if fit else '',
            'rank': digest.rank_score(job),
            # A kit writes Next step (Kit ready / Not eligible); the stage can stay Saved if the job was starred first.
            'notion_url': notion_row(job)[2],  # the job's Applications page: kit, verdict, notes
            'kit': notion_row(job)[0] == 'Kit ready' or notion_row(job)[1].startswith(('📝 Kit ready', NOT_ELIGIBLE)),
            # The kit's eligibility verdict, written to Next step when it was drafted.
            'ineligible': notion_row(job)[1][len(NOT_ELIGIBLE):] if notion_row(job)[1].startswith(NOT_ELIGIBLE) else '',
        })
    rows.sort(key=lambda r: (r['fit'] is not None, r['fit'] or 0, r['rank']), reverse=True)
    return {'jobs': rows[:limit], 'total': len(rows), 'filtered': len(blocked)}


def posting(db, code):
    """The job whose code (job_code of its URL) is given, with the posting text stored by the crawl."""
    rows = db.execute("""SELECT jobs.title, jobs.url, jobs.location, jobs.description, companies.name company
                          FROM jobs JOIN companies ON companies.id=jobs.company_id WHERE jobs.url IS NOT NULL""").fetchall()
    for row in rows:
        if job_code(row['url']) == code:
            return {'ok': True, 'code': code, 'title': row['title'], 'company': row['company'], 'url': row['url'],
                    'location': row['location'] or '', 'description': row['description'] or ''}
    return {'ok': False, 'error': 'job not found'}


NOTION_STAGES = {'saved': 'Saved', 'applied': 'Applied', 'dismissed': 'Dismissed'}


def set_status(db, url, status, tracker=None):
    """Record the status locally and, with Notion connected, as the job's Applications stage (the source
    of truth; Saved/Dismissed never overwrite a real application stage, see Tracker.mark)."""
    row = db.execute("""SELECT jobs.id, jobs.title, jobs.url, jobs.location, jobs.posted_at, jobs.first_seen_at,
                                 companies.name company FROM jobs JOIN companies ON companies.id=jobs.company_id
                          WHERE jobs.url=?""", (url,)).fetchone()
    if not row:
        return {'ok': False, 'error': 'job not found'}
    outcome = None
    if tracker and status in NOTION_STAGES:  # Notion first: if it can't be written, nothing changes
        try:
            _, outcome = tracker.mark(dict(row), NOTION_STAGES[status])
        except Exception as error:  # noqa: BLE001 — shown to the user; the local cache stays as it was
            return {'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing changed. Try again.'}
    store.set_application_status(db, row['id'], status)
    db.commit()
    return {'ok': True, 'notion': outcome} if outcome else {'ok': True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    listing = sub.add_parser('jobs')
    listing.add_argument('--limit', type=int, default=200)
    marking = sub.add_parser('status')
    marking.add_argument('url')
    marking.add_argument('status', choices=STATUSES)
    sub.add_parser('posting').add_argument('code')
    args = parser.parse_args(argv)
    with store.connect(JOBS_DB) as db:
        if args.command == 'posting':
            print(json.dumps(posting(db, args.code), ensure_ascii=False))
            return 0
        from .notion.client import Tracker
        tracker = Tracker.from_env()
        if args.command == 'jobs':
            stages, fresh = {}, False
            if tracker:
                try:
                    stages, fresh = tracker.url_rows(), True
                except Exception as error:  # the list still shows from the cache, marked as possibly out of date
                    print(f'Warning: Notion stages unavailable: {type(error).__name__}: {error}', file=__import__('sys').stderr)
            result = jobs(db, args.limit, stages, notion=fresh)
            if tracker and not fresh:
                result['stale'] = True
        else:
            result = set_status(db, args.url, args.status, tracker)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
