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


NOT_ELIGIBLE = '⛔ Not eligible: '
GONE = ('Not seen', 'Closed')  # Job Matches statuses of postings no longer listed


def _kit(stage, step):
    return stage == 'Kit ready' or step.startswith(('📝 Kit ready', NOT_ELIGIBLE))


def jobs(db, limit=200, stages=None, notion=False, notion_jobs=None):
    """The Jobs list, best fit first (unscored after scored, then the rule-based rank).

    notion_jobs (Tracker.notion_jobs): the list itself, from Notion (the source of truth), with Notion's fields only;
    the cache is kept in step with it, and adds only jobs a search found but couldn't write to Notion yet (marked
    unsynced). Without it (Notion unreachable, or not connected) the list comes from the cache, marked stale.
    stages: job URL -> (Stage, Next step, page URL), for the cache-only list."""
    stages = stages or {}
    candidates, blocked = digest.eligible_jobs(db)
    fits = score.load(db)
    local = {(job.get('url') or '').strip(): job for job in candidates}
    hidden = {(job.get('url') or '').strip() for job in blocked}
    rows = []

    def row(job, fit, reason, status, stage, step, page, **extra):
        return {'id': job.get('id'), 'code': job_code(job['url']) if job.get('url') else '',
                'title': job.get('title') or '', 'company': job.get('company') or '', 'location': job.get('location') or '',
                'work_mode': job.get('work_mode') or '', 'url': job.get('url') or '',
                'posted_at': job.get('posted_at') or '', 'first_seen_at': job.get('first_seen_at') or '',
                'status': status, 'fit': fit, 'reason': reason or '', 'rank': digest.rank_score(job) if job.get('id') else 0,
                'notion_url': page or '',  # the job's Applications page: kit, verdict, notes
                'stage': stage or '',  # the Applications Stage (Applied, Interviewing, Rejected…): the app's application counters
                # A kit writes Next step (Kit ready / Not eligible); the stage can stay Saved if the job was starred first.
                'kit': _kit(stage, step or ''),
                'ineligible': step[len(NOT_ELIGIBLE):] if (step or '').startswith(NOT_ELIGIBLE) else '', **extra}

    if notion_jobs is not None:
        seen = set()
        for item in notion_jobs:
            url, stage = item['url'], item.get('stage')
            seen.add(url)
            if url in hidden or digest.company_excluded(item) or (item.get('match_status') in GONE and not stage):
                continue
            status = stage_status(stage) if stage else {'Applied': 'applied', 'Dismissed': 'dismissed'}.get(item.get('match_status'), 'unreviewed')
            cached = local.get(url)
            if cached and status != (cached.get('application_status') or 'unreviewed'):  # keep the cache in step
                store.set_application_status(db, cached['id'], status)
            # Only Notion's fields: a field the list needs is a Notion column (config/notion_schema.json), never cache-only.
            job = {'url': url, 'title': item.get('title'), 'company': item.get('company'), 'location': item.get('location'),
                   'work_mode': item.get('work_mode'), 'first_seen_at': item.get('first_seen', '')}
            rows.append(row(job, item.get('fit'), item.get('reason'), status, stage, item.get('next_step'), item.get('notion_url')))
        for url, job in local.items():  # found by a search, not in Notion yet (its sync failed): shown, marked
            if url and url not in seen:
                fit = fits.get(job['id'])
                rows.append(row(job, fit.get('score') if fit else None, (fit.get('summary') or fit.get('reason')) if fit else '',
                                job.get('application_status') or 'unreviewed', None, '', '', unsynced=True))
    else:
        def notion_row(job):  # (Stage, Next step, Notion page URL); tests may pass plain stages
            value = stages.get((job.get('url') or '').strip(), (None, '', ''))
            return (tuple(value) + ('', ''))[:3] if isinstance(value, tuple) else (value, '', '')
        for job in candidates:
            fit = fits.get(job['id'])
            stage, step, page = notion_row(job)
            if notion:  # Notion wins; keep the local cache in step
                truth = stage_status(stage)
                if truth != (job.get('application_status') or 'unreviewed'):
                    store.set_application_status(db, job['id'], truth)
                    job = {**job, 'application_status': truth}
            rows.append(row(job, fit.get('score') if fit else None, (fit.get('summary') or fit.get('reason')) if fit else '',
                            job.get('application_status') or 'unreviewed', stage, step, page))
    rows.sort(key=lambda r: (r['fit'] is not None, r['fit'] or 0, r['rank']), reverse=True)
    # Every application stays in the list, however low its fit, so the app's application counters are complete.
    kept = rows[:limit] + [r for r in rows[limit:] if r['status'] == 'applied']
    return {'jobs': kept, 'total': len(rows), 'filtered': len(blocked)}


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
    if not row and tracker and status in NOTION_STAGES:  # a job only in Notion (no local copy): Notion alone
        item = next((j for j in tracker.notion_jobs() if j['url'] == url), None)
        if not item:
            return {'ok': False, 'error': 'job not found'}
        try:
            _, outcome = tracker.mark({'title': item['title'], 'company': item['company'], 'location': item['location'],
                                       'url': url, 'posted_at': '', 'first_seen_at': item.get('first_seen', '')}, NOTION_STAGES[status])
        except Exception as error:  # noqa: BLE001
            return {'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing changed. Try again.'}
        return {'ok': True, 'notion': outcome}
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
            found = None
            if tracker:
                try:
                    found = tracker.notion_jobs()  # the list, from Notion
                except Exception as error:  # the list still shows from the cache, marked as possibly out of date
                    print(f'Warning: Notion unavailable, showing the cached list: {type(error).__name__}: {error}',
                          file=__import__('sys').stderr)
            result = jobs(db, args.limit, notion_jobs=found)
            fresh = found is not None
            if tracker and not fresh:
                result['stale'] = True
        else:
            result = set_status(db, args.url, args.status, tracker)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
