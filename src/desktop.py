#!/usr/bin/env python3
"""JSON commands for the desktop app (desktop/), which runs this package as a local helper.

    python -m src.desktop jobs [--limit 200]     ranked open jobs with fit score and application status
    python -m src.desktop status <URL> <status>  record an application status locally (applied, saved, dismissed)

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


def jobs(db, limit=200, stages=None):
    """Eligible open jobs, best fit first (unscored after scored, then the rule-based rank).

    stages: job URL -> Notion Applications Stage. Kits live in Notion; a job has one when its Stage is Kit ready."""
    stages = stages or {}
    candidates, blocked = digest.eligible_jobs(db)
    fits = score.load(db)
    rows = []
    for job in candidates:
        fit = fits.get(job['id'])
        rows.append({
            'id': job['id'], 'code': job_code(job['url']) if job.get('url') else '',
            'title': job['title'], 'company': job['company'], 'location': job.get('location') or '',
            'work_mode': job.get('work_mode') or '', 'url': job.get('url') or '',
            'posted_at': job.get('posted_at') or '', 'first_seen_at': job.get('first_seen_at') or '',
            'status': job.get('application_status') or 'unreviewed',
            'fit': fit.get('score') if fit else None,
            'reason': (fit.get('summary') or fit.get('reason') or '') if fit else '',
            'rank': digest.rank_score(job),
            'kit': stages.get((job.get('url') or '').strip()) == 'Kit ready',
        })
    rows.sort(key=lambda r: (r['fit'] is not None, r['fit'] or 0, r['rank']), reverse=True)
    return {'jobs': rows[:limit], 'total': len(rows), 'filtered': len(blocked)}


NOTION_STAGES = {'saved': 'Saved', 'applied': 'Applied', 'dismissed': 'Dismissed'}


def set_status(db, url, status, tracker=None):
    """Record the status locally and, with Notion connected, as the job's Applications stage (the source
    of truth; Saved/Dismissed never overwrite a real application stage, see Tracker.mark)."""
    row = db.execute("""SELECT jobs.id, jobs.title, jobs.url, jobs.location, jobs.posted_at, jobs.first_seen_at,
                                 companies.name company FROM jobs JOIN companies ON companies.id=jobs.company_id
                          WHERE jobs.url=?""", (url,)).fetchone()
    if not row:
        return {'ok': False, 'error': 'job not found'}
    store.set_application_status(db, row['id'], status)
    db.commit()
    if tracker and status in NOTION_STAGES:
        _, outcome = tracker.mark(dict(row), NOTION_STAGES[status])
        return {'ok': True, 'notion': outcome}
    return {'ok': True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    listing = sub.add_parser('jobs')
    listing.add_argument('--limit', type=int, default=200)
    marking = sub.add_parser('status')
    marking.add_argument('url')
    marking.add_argument('status', choices=STATUSES)
    args = parser.parse_args(argv)
    with store.connect(JOBS_DB) as db:
        from .notion.client import Tracker
        tracker = Tracker.from_env()
        if args.command == 'jobs':
            stages = {}
            if tracker:
                try:
                    stages = tracker.url_stages()
                except Exception as error:  # the list still shows without Notion; Apply then waits for a kit
                    print(f'Warning: Notion stages unavailable: {type(error).__name__}: {error}', file=__import__('sys').stderr)
            result = jobs(db, args.limit, stages)
        else:
            result = set_status(db, args.url, args.status, tracker)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
