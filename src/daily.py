#!/usr/bin/env python3
"""Run the local scan, import canonical state and optionally send Telegram digest."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from html import escape
import json
import os
import random
import re

from . import digest, features, scout, store, telegram
from . import doctor
from .ai import budget, cost, enrich, insights, interviews, kit, score
from .notion import client as notion, cron_runs, funnel, ledger, matches
from pathlib import Path

from .paths import JOBS_DB, CONFIG, DATA, REPORTS, load_search_config
from .sources import ats, feeds, google_jobs



new_cron_run = cron_runs.new_run  # kept for callers and tests


def crawl_counts(report, statuses):
    """Feed and import numbers for the run report."""
    counted = Counter(statuses)
    failing = [s['company'] for s in report.get('sources', []) if not s.get('ok')]
    return {'feeds': len(report.get('sources', [])), 'feed_errors': len(failing), 'failing_feeds': failing,
            'new': counted.get('new', 0), 'changed': counted.get('changed', 0)}


def top_new(report, scored, limit=3):
    """[(title, company, score)] for jobs first seen this run, best score first."""
    new_urls = {j['url'] for j in report.get('jobs', []) if j.get('status') == 'new'}
    hits = [(j['title'], j['company'], j['fit']['score']) for j in scored if j.get('url') in new_urls]
    return sorted(hits, key=lambda h: h[2], reverse=True)[:limit]


STALE_DAYS = 7  # A job not seen by a full crawl for this long is closed (reopened if seen again).
MODES = ('scheduled', 'run', 'today', 'apply', 'more', 'prepare', 'insight', 'weekly', 'interview', 'add')


def find_job(db, code):
    """Job by its 8-hex code, or by URL (the browser extension sends the page it is on)."""
    wanted = _url_key(code) if '/' in code else None
    for job in store.digest_jobs(db, limit=10_000, only_new=False):
        url = job.get('url')
        if url and (notion.job_code(url) == code or (wanted and _url_key(url) == wanted)):
            return job
    return None


def tracked_job(code, tracker):
    """A job known to Notion but absent from the crawl's SQLite (evicted cache, reset DB, or a
    filter that no longer admits it): rebuilt from its Applications row, or else its Job Matches
    row, with the posting text fetched live from its job board. Matches by URL or by 8-hex code.
    None if Notion has neither."""
    if not tracker:
        return None
    wanted = _url_key(code) if '/' in code else None
    matches = lambda u: (wanted and _url_key(u) == wanted) or notion.job_code(u) == code
    url = next((u for u in tracker.url_stages() if matches(u)), None)
    row = tracker.find(url) if url else None
    if not row:
        row = next((r for r in tracker.query_database(notion.MATCHES_DATABASE_ID)
                    if matches((r['properties'].get('Job URL') or {}).get('url') or '')), None)
        url = (row['properties'].get('Job URL') or {}).get('url') if row else None
    if not row:
        return None
    props = row['properties']
    text = lambda name: ''.join(t.get('plain_text', '') for t in
                                (props.get(name) or {}).get('title' if name == 'Job' else 'rich_text', []))
    live = ats.posting(url) or {}
    return {'id': None, 'url': url, 'title': live.get('title') or text('Job'),
            'company': text('Company'), 'location': live.get('location') or text('Location'),
            'description': live.get('description', ''), 'work_mode': '', 'city': ''}


def _job_arg(value):
    value = value.strip()
    return value if '/' in value else value.lower()


def _url_key(url):
    """Greenhouse links to one job come in several forms; compare them by board-independent job id."""
    match = re.search(r'greenhouse\.io/[\w-]+/jobs/(\d+)', url) or re.search(r'[?&]gh_jid=(\d+)', url)
    return f'greenhouse:{match.group(1)}' if match else url.split('?')[0].split('#')[0].rstrip('/').lower()


ACTIONS = {'applied': 'Applied', 'saved': 'Saved', 'dismissed': 'Dismissed'}


def apply_message(db, code, tracker, action='applied'):
    """Record a Telegram button action for the job with this code in Notion; return the reply text."""
    job = find_job(db, code) or tracked_job(code, tracker)
    if not job:
        return f"⚠️ No job with code <code>{escape(code)}</code>. It may have closed; add it in Notion manually."
    stage = ACTIONS[action]
    page, outcome = tracker.mark(job, stage)
    if stage == 'Applied' and outcome != 'unchanged':
        # The application ledger: an Applied event and the frozen record (no form capture from CI,
        # so answers are the kit drafts). Never blocks the reply.
        try:
            ledger.add_event(tracker, page, 'Applied', 'Telegram')
            ledger.record(tracker, job['url'])
        except Exception as error:
            print(f'Warning: application record skipped: {type(error).__name__}: {error}')
        queue_mail_check()
    link = f'<a href="{escape(page.get("url", ""), quote=True)}">Notion</a>'
    title = f"<b>{escape(job['title'])}</b> — {escape(job['company'])}"
    if outcome == 'unchanged':
        return f"ℹ️ Already tracked: {title}\nSee {link}."
    return {
        'Applied': f"✅ Marked applied: {title}\nIt won't appear in digests again. Track the stage in {link}.",
        'Saved': f"⭐ Saved: {title}\nIt stays in digests with a star; /saved lists your saved jobs.",
        'Dismissed': f"❌ Dismissed: {title}\nIt won't appear again, and helps tune the scores.",
    }[stage]


def queue_mail_check(delay=5):
    """Start the Gmail + Calendar workflow in `delay` minutes, so an application's confirmation email is
    picked up soon after it's marked Applied. Needs GITHUB_TOKEN/GITHUB_REPOSITORY (set in Actions);
    a no-op elsewhere, and a failure never blocks the reply."""
    token, repo = os.getenv('GITHUB_TOKEN'), os.getenv('GITHUB_REPOSITORY')
    if not token or not repo:
        return False
    import urllib.request
    request = urllib.request.Request(
        f'https://api.github.com/repos/{repo}/actions/workflows/mail.yml/dispatches', method='POST',
        data=json.dumps({'ref': 'main', 'inputs': {'delay': str(delay)}}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json'})
    try:
        with urllib.request.urlopen(request, timeout=20):
            return True
    except Exception as error:
        print(f'Warning: mail check not queued: {type(error).__name__}: {error}')
        return False


def log_ai_run(tracker, run, args):
    """⏰ Cronjob Runs row for an on-demand AI job (kit, interview, insight, weekly), so the month's rows add
    up to the AI spend the budget guard reads. Only real (sending) runs are logged, like the crawl."""
    if tracker and args.send:
        run['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(run['started_at'])).total_seconds())
        cron_runs.log_run(tracker, run)


def prepare_kit(db, code, tracker, client=None, model=kit.DEFAULT_MODEL, opener=None, stats=None):
    """Draft the application kit for one job; save it on its Notion Applications row.

    Returns (Telegram messages, log line). The row is created as Saved if the job isn't tracked yet."""
    job = find_job(db, code) or tracked_job(code, tracker)
    if not job:
        return [f"⚠️ No job with code <code>{escape(code)}</code>. It may have closed."], 'job not found'
    if job['id'] is not None:
        job = dict(job, ai=enrich.load(db).get(job['id']), fit=score.load(db).get(job['id']))
    try:
        questions = kit.form_questions(job['url'], opener)
    except Exception as error:  # An unreadable form still gets a kit, with likely questions.
        print(f'Warning: form questions unavailable: {type(error).__name__}: {error}')
        questions = []
    profile, answers = tracker.page_text(), tracker.page_text(kit.ANSWERS_PAGE_ID)
    if client is None:
        import anthropic
        client = anthropic.Anthropic()
    drafted, usage = kit.draft(client, model, job, profile, answers, questions)
    cost.add(stats, model, usage)
    if stats is not None:
        stats.update(pending=1, done=1)
    page, _ = tracker.mark(job, 'Kit ready')
    tracker.replace_section(page['id'], kit.KIT_HEADING, kit.notion_blocks(job, drafted, questions, model))
    kit.record_cost(tracker, page, model, usage)
    return kit.telegram_messages(job, drafted, questions, page.get('url')), kit.cost_line(model, usage)


def apply_switches(args):
    """JOB_PILOTTO_DISABLE (src/features.py) wins over the flags the workflow passes."""
    for name, flag in (('enrich', 'enrich_max'), ('score', 'score_max'), ('auto_kits', 'auto_kit_max')):
        if features.disabled(name):
            setattr(args, flag, 0)
    if features.disabled('insights'):
        args.insight = False
    if features.disabled('telegram'):
        args.send = False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=JOBS_DB)
    parser.add_argument('--company-report', type=Path, default=REPORTS / 'companies.json')
    parser.add_argument('--limit', type=int, default=50, help='jobs in the ranked list, paged 10 at a time')
    parser.add_argument('--page', type=int, default=1)
    parser.add_argument('--seed', type=int, help='ranking seed from a ➕ Next button, so pages continue')
    parser.add_argument('--send', action='store_true', help='send to Telegram; otherwise print preview only')
    parser.add_argument('--mode', choices=MODES, default='scheduled',
                        help='scheduled: send only when new jobs exist; run/today: always send; '
                             'apply: mark --job as applied in Notion; prepare: draft its application kit')
    parser.add_argument('--job', help='job code from /apply_<code>, for --mode apply or prepare')
    parser.add_argument('--action', choices=sorted(ACTIONS), default='applied',
                        help='for --mode apply: applied, saved or dismissed')
    parser.add_argument('--score-max', type=int, default=0,
                        help='AI stage 2: score up to N eligible jobs against the Notion Profile (0 = off)')
    parser.add_argument('--enrich-max', type=int, default=0,
                        help='AI stage 1: extract facts for up to N new/changed jobs after import (0 = off)')
    parser.add_argument('--auto-kit-max', type=int, default=0,
                        help='auto-draft application kits for up to N best-scored new jobs per run (0 = off)')
    parser.add_argument('--auto-kit-min-score', type=int, default=kit.DEFAULT_AUTO_MIN_SCORE,
                        help='minimum fit score to qualify for an automatic kit')
    parser.add_argument('--file', help='interview mode: Telegram file id of the transcript')
    parser.add_argument('--note', default='', help='interview mode: the caption, or "/interview <label>" plus notes')
    parser.add_argument('--insight', action='store_true',
                        help="scheduled mode: send the day's insight if it's due (insight mode always sends one)")
    args = parser.parse_args()
    if not 1 <= args.limit <= 50:
        parser.error('--limit must be between 1 and 50')
    apply_switches(args)
    tracker = notion.Tracker.from_env()
    if args.mode == 'apply':
        if not args.job or not tracker:
            raise SystemExit('--mode apply requires --job and NOTION_TOKEN')
        with store.connect(args.db) as db:
            reply = apply_message(db, _job_arg(args.job), tracker, args.action)
        print(reply)
        # Save/Dismiss are already confirmed on the button itself; only Applied gets a message (Notion link).
        if args.send and args.action == 'applied':
            telegram.send(reply, *telegram.credentials())
        return 0
    if args.mode == 'prepare':
        if not args.job or not tracker:
            raise SystemExit('--mode prepare requires --job and NOTION_TOKEN')
        run = new_cron_run('prepare')
        run['kits'] = {}
        with store.connect(args.db) as db:
            messages, log = prepare_kit(db, _job_arg(args.job), tracker, stats=run['kits'])
        print(log)
        log_ai_run(tracker, run, args)
        print('\n\n'.join(messages))
        if args.send:
            credentials = telegram.credentials()
            for message in messages:
                telegram.send(message, *credentials)
        return 0
    if args.mode == 'add':
        # /add <job URL> [date]: track an application made outside Job Pilotto.
        if not args.job or not tracker:
            raise SystemExit('--mode add requires --job <URL> and NOTION_TOKEN')
        try:
            applied, approx = ledger.parse_applied(args.note)
            reply = '📥 ' + escape(ledger.add_application(tracker, args.job, applied=applied, approx=approx,
                                                          source='Telegram'))
            queue_mail_check()
        except ValueError as error:
            reply = f'⚠️ {escape(str(error))}'
        print(reply)
        if args.send:
            telegram.send(reply, *telegram.credentials())
        return 0
    if args.mode == 'interview':
        if not tracker:
            raise SystemExit('--mode interview requires NOTION_TOKEN')
        token, chat_id = telegram.credentials()
        sender = (lambda text: telegram.send(text, token, chat_id)) if args.send else None
        run = new_cron_run('interview')
        run['interview'] = {}
        try:
            print(interviews.run(tracker, file_id=args.file, note=args.note, token=token, send=sender,
                                 stats=run['interview']))
            run['interview'].update(pending=1, done=1)
            log_ai_run(tracker, run, args)
        except ValueError as error:  # the owner sent something that can't be analysed: say why
            print(error)
            if sender:
                sender(f'⚠️ {escape(str(error))}')
        except Exception as error:
            if not cost.limit_reached(error):
                raise
            run_url = f"{os.getenv('GITHUB_SERVER_URL', 'https://github.com')}/{os.getenv('GITHUB_REPOSITORY', '')}/actions/runs/{os.getenv('GITHUB_RUN_ID', '')}"
            message = cost.LIMIT_MESSAGE.format(what='the interview review', retry=(
                ' Your transcript is kept: after raising it, send it again, or re-run '
                f'<a href="{escape(run_url, quote=True)}">this run</a>.' if os.getenv('GITHUB_RUN_ID') else ''))
            print(message)
            if sender:
                sender(message)
        return 0
    if args.mode in ('insight', 'weekly'):
        if not tracker:
            raise SystemExit(f'--mode {args.mode} requires NOTION_TOKEN')
        sender = (lambda text, markup: telegram.send(text, *telegram.credentials(), markup)) if args.send else None
        with store.connect(args.db) as db:
            make = insights.run if args.mode == 'insight' else insights.weekly
            run = new_cron_run(args.mode)
            run['insight'] = {}
            try:
                print(make(db, tracker, send=sender, stats=run['insight'],
                           **({'force': True} if args.mode == 'insight' else {})))
                log_ai_run(tracker, run, args)
            except Exception as error:
                if not cost.limit_reached(error):
                    raise
                message = cost.LIMIT_MESSAGE.format(what=f'the {args.mode} report', retry='')
                print(message)
                if args.send:
                    telegram.send(message, *telegram.credentials())
        return 0
    run = new_cron_run(args.mode)
    spend = None
    if tracker and args.mode in ('scheduled', 'run', 'today'):
        # AI budget: at 90% of the month's limit the optional AI steps pause; alerts are sent at the end.
        try:
            spend = budget.status(tracker)
            print(f'AI budget: {budget.describe(spend)}')
            budget.apply_caps(args, spend, run['warnings'])
        except Exception as error:
            print(f'Warning: budget check skipped: {type(error).__name__}: {error}')
    hidden, saved, dismissed = frozenset(), frozenset(), frozenset()
    if tracker:
        try:
            stages = tracker.url_stages()
            hidden = frozenset(u for u, st in stages.items() if st not in notion.VISIBLE_STAGES)
            saved = frozenset(u for u, st in stages.items() if st == 'Saved')
            dismissed = frozenset(u for u, st in stages.items() if st == 'Dismissed')
        except Exception as error:  # A Notion outage shouldn't block the digest.
            print(f'Warning: could not read Notion applications: {error}')
            run['warnings'].append(f'Notion applications unreadable: {error}')
    sources = json.loads((CONFIG / 'sources.json').read_text())
    report, imported = {'jobs': [], 'sources': []}, []
    with store.connect(args.db) as db:
        # A '➕ Next' page reads the stored list as is: importing would mark new jobs
        # as seen and reorder the list between pages.
        if args.mode != 'more':
            # The feed watcher and canonical store intentionally have different schemas.
            # Keep the source-specific history separate, then import the report.
            # sources.json plus every active feed the scout found (local table + Notion Source Registry).
            feed_list = scout.active_sources(db, tracker, sources)
            with feeds.database(DATA / 'jobs.sqlite') as feed_db:
                report = feeds.scan(feed_list, feed_db)
                # Paid per search, so only full crawls use it; off without SERPAPI_API_KEY.
                if args.mode in ('scheduled', 'run') and google_jobs.api_key():
                    google = google_jobs.scan(feed_db, google_jobs.api_key(),
                                              google_jobs.settings(load_search_config()))
                    report['jobs'] += google['jobs']
                    report['sources'] += google['sources']
            imported = store.import_watch_report(db, report)
            run.update(crawl_counts(report, imported))
            if args.mode in ('scheduled', 'run'):
                # Only full crawls can tell that a job disappeared.
                run['closed_stale'] = store.close_stale(db, STALE_DAYS)
                print(f"Closed {run['closed_stale']} job(s) not seen for {STALE_DAYS} days")
        if args.mode != 'more' and args.company_report.exists():
            company_report = json.loads(args.company_report.read_text())
            imported += store.import_company_report(db, company_report)
        if args.enrich_max:
            # Runs after import so fresh descriptions are included. AI trouble never blocks the digest.
            try:
                run['enrich'] = {}
                print(enrich.run(db, enrich.DEFAULT_MODEL, args.enrich_max, stats=run['enrich']))
            except Exception as error:
                print(f'Warning: enrichment skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'enrichment skipped: {type(error).__name__}')
        if args.score_max and tracker:
            # Scores only jobs that survive the hard filters; the Profile is re-read every run.
            try:
                profile = tracker.page_text()
                candidates, _ = digest.eligible_jobs(db, hidden)
                run['score'] = {}
                print(score.run(db, candidates, profile, score.DEFAULT_MODEL, args.score_max, stats=run['score']))
            except Exception as error:
                print(f'Warning: scoring skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'scoring skipped: {type(error).__name__}')
        if tracker and args.mode in ('scheduled', 'run', 'today'):
            # Mirror scored jobs into Notion "Job Matches"; a Notion problem never blocks the digest.
            try:
                fits = score.load(db)
                candidates, _ = digest.eligible_jobs(db, hidden)
                scored = [dict(j, fit=fits[j['id']]) for j in candidates if j['id'] in fits]
                open_urls = {j['url'].strip() for j in store.digest_jobs(db, limit=10_000) if j.get('url')}
                applied_urls = hidden - dismissed
                run['top_new'] = top_new(report, scored)
                run['matches'] = matches.sync(db, tracker, scored, applied_urls, open_urls, dismissed)
                print(run['matches'])
                if args.auto_kit_max:
                    # Runs after scoring so it sees the same fits; a kit failure never blocks the digest.
                    run['kits'] = {}
                    summary, drafted_jobs = kit.auto_run(db, scored, tracker, kit.DEFAULT_MODEL,
                                                         args.auto_kit_max, args.auto_kit_min_score,
                                                         stats=run['kits'])
                    run['kit_titles'] = [f"{job['title']} ({job['company']})" for job, _ in drafted_jobs]
                    print(summary)
                    if drafted_jobs and args.send:
                        lines = [f"📝 <b>{len(drafted_jobs)} application kit(s) ready</b> — drafted automatically, "
                                 "nothing sent."]
                        for job, page in drafted_jobs:
                            lines.append(f"• <a href=\"{escape(job['url'], quote=True)}\">{escape(job['title'])}</a>"
                                         f" — {escape(job['company'])} · "
                                         f"<a href=\"{escape(page.get('url', ''), quote=True)}\">Notion</a>")
                        telegram.send('\n'.join(lines), *telegram.credentials())
            except Exception as error:
                print(f'Warning: Notion Job Matches sync or auto-kit skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'Job Matches sync or auto-kit skipped: {type(error).__name__}')
        if tracker and args.mode == 'scheduled':
            # Application ledger: log Stage edits made in Notion, and mark silent applications No response.
            try:
                print(ledger.sync(tracker))
            except Exception as error:
                print(f'Warning: ledger sync skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'ledger sync skipped: {type(error).__name__}')
            # 🎯 Pipeline page: conversion between funnel steps and the step to improve (no AI).
            try:
                funnel.write(tracker, funnel.funnel(funnel.reached(tracker)),
                             datetime.now(timezone.utc).strftime('%d %b %H:%M UTC'))
            except Exception as error:
                print(f'Warning: funnel update skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'funnel update skipped: {type(error).__name__}')
        seed = args.seed or random.randrange(1, 10**9)
        shown_ids = []
        messages, new_count, keyboards = digest.build_digest(db, args.limit, hidden_urls=hidden, page=args.page,
                                                      seed=seed, shown_ids=shown_ids, saved_urls=saved)
    text = '\n\n'.join(messages)
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / 'daily-latest.txt').write_text(text + '\n', encoding='utf-8')
    (REPORTS / 'daily-latest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(text)
    if not args.send:
        print('\nPreview only. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then rerun with --send.')
        return 0
    token, chat_id = telegram.credentials()
    if args.mode == 'scheduled' and not new_count:
        print('\nNo new jobs since the last run; nothing sent.')
        run['telegram'] = 'nothing new; not sent'
    else:
        for message, keyboard in zip(messages, keyboards):
            telegram.send(message, token, chat_id, keyboard)
        if args.mode != 'more':
            # '➕ Next' runs don't save the database, so only first pages count for rotation.
            with store.connect(args.db) as db:
                digest.mark_shown(db, shown_ids, seed)
        print(f'\nSent {len(messages)} Telegram message(s); imported {len(imported)} jobs.')
        run['telegram'] = f'sent {len(messages)} message(s), {new_count} new'
    if spend:
        with store.connect(args.db) as db:
            budget.alert_once(db, spend, lambda text: telegram.send(text, token, chat_id))
    if tracker and args.mode == 'scheduled' and datetime.now(timezone.utc).hour == doctor.HEALTH_HOUR_UTC:
        # Once a day: one Telegram line if a health check fails (Google sign-in, mail, budget, feeds).
        try:
            print(doctor.alert(tracker, lambda text: telegram.send(text, token, chat_id)))
        except Exception as error:
            print(f'Warning: health check skipped: {type(error).__name__}: {error}')
    if tracker and args.insight and args.mode == 'scheduled':
        # One insight a day, with the first scheduled run after insights.SEND_HOUR_UTC.
        try:
            run['insight'] = {}
            with store.connect(args.db) as db:
                print(insights.run(db, tracker, send=lambda text, markup: telegram.send(text, token, chat_id, markup),
                                   stats=run['insight']))
        except Exception as error:
            print(f'Warning: insight skipped: {type(error).__name__}: {error}')
            run['warnings'].append(f'insight skipped: {type(error).__name__}')
    if tracker and args.mode in ('scheduled', 'run', 'today'):
        # Only sending runs are logged, so local previews don't fill the table.
        run['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(run['started_at'])).total_seconds())
        url = cron_runs.log_run(tracker, run)
        if url:
            print(f'Cronjob run logged: {url}')
    return 0


if __name__ == '__main__':
    main()
