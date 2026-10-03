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
import sys

from . import contribute, digest, employer_index, features, import_url, scout, store, telegram
from . import doctor
from . import coverage
from .ai import added, budget, cost, enrich, inbox, insights, interview_insights, interviews, kit, provenance, score
from .notion import client as notion, cron_runs, funnel, ledger, matches
from pathlib import Path

from .paths import JOBS_DB, CONFIG, DATA, REPORTS, load_search_config, local_profile
from .sources import ats, describe, feeds, google_jobs



new_cron_run = cron_runs.new_run  # kept for callers and tests



def left_out(stats, what):
    """A warning when an AI step left jobs out (each failed, or the run stopped at the Anthropic spending limit), so the
    run shows "Warnings" in ⏱️ Search runs and the app, not a green "Completed" (29 Sep 2026: 23 jobs unscored)."""
    left = (stats.get('pending') or 0) - (stats.get('done') or 0)
    if left <= 0:
        return []
    why = ('your Claude Code plan limit was reached (or it is signed out)' if stats.get('limit') == 'cli' else
           'the Anthropic API spending limit was reached' if stats.get('limit') else 'the AI call failed')
    return [f'{left} job(s) not {what}: {why}']

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
MODES = ('scheduled', 'run', 'today', 'apply', 'more', 'prepare', 'insight', 'weekly', 'interview', 'add', 'import')


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


def for_job_matches(db, hidden):
    """The scored open jobs mirrored into Notion Job Matches: what the search found. Jobs you added yourself
    (src/ai/added.py) are left out: they live on Applications only, with their fit columns there."""
    fits, yours = score.load(db), store.added_source_ids(db)
    candidates, _ = digest.eligible_jobs(db, hidden)
    return [dict(j, fit=fits[j['id']]) for j in candidates if j['id'] in fits and j.get('source_id') not in yours]


def _job_arg(value):
    value = value.strip()
    return value if '/' in value else value.lower()


def _url_key(url):
    """Greenhouse links to one job come in several forms; compare them by board-independent job id."""
    match = re.search(r'greenhouse\.io/[\w-]+/jobs/(\d+)', url) or re.search(r'[?&]gh_jid=(\d+)', url)
    if not match and 'greenhouse.io' in (url or ''):
        match = re.search(r'[?&]token=(\d+)', url)
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


def log_text(html):
    """A Telegram HTML reply as plain text for the terminal and the app's activity log (no tags, no &#x27;)."""
    return telegram.plain(html)


def log_ai_run(tracker, run, args, failed=False):
    """⏰ Cronjob Runs row for an on-demand AI job (kit, interview, insight, weekly), so the month's rows add
    up to the AI spend the budget guard reads. Sending runs and the desktop app's runs (--log-run) are logged."""
    if tracker and (args.send or args.log_run):
        run['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(run['started_at'])).total_seconds())
        url = cron_runs.log_run(tracker, run, failed=failed)
        if url:
            print(f'Cronjob run logged: {url}')  # the app's Recent activity links "See it full in Notion" to this


def prepare_kit(db, code, tracker, client=None, model=kit.DEFAULT_MODEL, opener=None, stats=None, run=None):
    """Draft the application kit for one job; save it on its Notion Applications row (run: its ⏱️ Search runs row
    links to that row, shown on the job's page as Runs).

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
    profile, answers = tracker.page_text(), kit.standard_answers(tracker)
    if client is None:
        from .ai import engine
        client = engine.client(action='kit')
    drafted, usage = kit.draft(client, model, job, profile, answers, questions)
    cost.add(stats, model, usage)
    if stats is not None:
        stats.update(pending=1, done=1)
    page, _ = tracker.mark(job, 'Kit ready')
    if run is not None:
        run['application'] = page['id']  # the run links to the job it was for, and its title names it
        run['subject'] = cron_runs.job_subject(page) or cron_runs.job_subject(company=job.get('company', ''), role=job.get('title', ''))
    tracker.replace_section(page['id'], kit.KIT_HEADING, kit.notion_blocks(job, drafted, questions, model))
    kit.record_next_step(tracker, page, drafted)
    kit.record_cost(tracker, page, model, usage)
    provenance.record_kit(tracker, page, profile, answers)
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


def digest_note(shown, new, terminal):
    """The line after a digest nobody was sent: the app's users are not told to use a terminal."""
    note = f"Digest ready: {plural(shown, 'job')}, {new} new. Telegram isn't connected, so nothing was sent"
    return note + (' (terminal: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then rerun with --send).' if terminal else '.')


def plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def save_run(run):
    """Duration and cost, then the summary of the latest crawl the desktop app's activity bar reads."""
    run['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(run['started_at'])).total_seconds())
    run['usd'] = round(cron_runs.total_usd(run), 4)
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / 'last-run.json').write_text(json.dumps(run, default=str, indent=2))


def log_crawl(tracker, run):
    url = cron_runs.log_run(tracker, run)
    if url:
        print(f'Cronjob run logged: {url}')  # the desktop app links its activity row to this


def downloaded_index():
    """The central employer index (cached, at most one download a day); [] when off or unreachable."""
    if features.disabled('index'):
        return []
    index = employer_index.load()
    # Default: only feeds with roles in your places. JOB_PILOTTO_INDEX_ALL=1 crawls the whole worldwide index.
    return index if os.getenv('JOB_PILOTTO_INDEX_ALL') else employer_index.relevant(index, feeds.wanted_location)


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
    parser.add_argument('--job', help='job code from /apply_<code>, for --mode apply or prepare; '
                                      'interview mode: the job URL the interview belongs to')
    parser.add_argument('--action', choices=sorted(ACTIONS) + ['talking'], default='applied',
                        help='for --mode apply: applied, saved or dismissed; for a recruiter lead (--mode add, no --job): talking')
    parser.add_argument('--score-max', type=int, default=0,
                        help='AI stage 2: score up to N eligible jobs against the Notion Profile (0 = off)')
    parser.add_argument('--enrich-max', type=int, default=0,
                        help='AI stage 1: extract facts for up to N new/changed jobs after import (0 = off)')
    parser.add_argument('--auto-kit-max', type=int, default=0,
                        help='auto-draft application kits for up to N best-scored new jobs per run (0 = off)')
    parser.add_argument('--auto-kit-min-score', type=int, default=kit.DEFAULT_AUTO_MIN_SCORE,
                        help='minimum fit score to qualify for an automatic kit')
    parser.add_argument('--file', help='interview mode: Telegram file id, or a local path, of the recording or transcript')
    parser.add_argument('--interview', help='interview mode: review this 🎤 Interviews row (saved from the app)')
    parser.add_argument('--note', default='', help='interview mode: the caption, or "/interview <label>" plus notes; add mode: the date applied, '
                             'or (without --job) the recruiter\'s message')
    parser.add_argument('--job-title', default='', help='add mode: the job title, when the page can\'t be read (LinkedIn…)')
    parser.add_argument('--job-company', default='', help='add mode: the company, when the page can\'t be read')
    parser.add_argument('--job-text', default='', help='add mode: the job description, pasted (for the AI stages)')
    parser.add_argument('--target', default='', help="add mode without --job: 'new', or the URL of the job it's about "
                                                      '(default: Claude decides)')
    parser.add_argument('--propose', action='store_true',
                        help='add mode without --job: read the message and print the proposal (JSON) to confirm; '
                             'nothing is written to Notion (the app\'s confirmation step)')
    parser.add_argument('--reading', default='', help='add mode: a --propose result (JSON file) to write, without reading again '
                                                      '(with --propose: proposed again for --target, the job you picked)')
    parser.add_argument('--channel', default='', help='add mode: where the conversation is from, as you confirmed it '
                                                      '(LinkedIn, Email, Phone, Other)')
    parser.add_argument('--channel-other', default='', help='add mode: what "Other" was (e.g. WhatsApp)')
    parser.add_argument('--started', default='', help='add mode: when the conversation started, as you confirmed it (YYYY-MM-DD)')
    parser.add_argument('--kind', default='', help='add mode: what it is, as you confirmed it (e.g. "Reply received")')
    parser.add_argument('--last-at', default='', help='add mode: the day of the last message, as you gave it (YYYY-MM-DD)')
    parser.add_argument('--interview-at', default='', help='add mode: the call\'s date and time, as you confirmed it (YYYY-MM-DDTHH:MM)')
    parser.add_argument('--company', default=None, help='add mode, a new job: the hiring company, as you confirmed it ("" = not named)')
    parser.add_argument('--agency', default=None, help='add mode, a new job: the recruiter\'s agency, as you confirmed it ("" = none)')
    parser.add_argument('--from-app', action='store_true', help='add mode: logged in the Desktop App (Source "Job Pilotto app", even with --send)')
    parser.add_argument('--first-contact', choices=('yes', 'no'), default=None,
                        help='add mode, a new job: this was the first contact about it (its Source follows the channel)')
    parser.add_argument('--origin', choices=('inbound', 'outbound'), default=None,
                        help='add mode, a tracked job: who reached out first, as you answered it (inbound: they did)')
    parser.add_argument('--agreed', choices=('yes', 'no'), default=None,
                        help='add mode: your answer to "Did you agree to talk to the recruiter?" (yes: Screening)')
    parser.add_argument('--log-run', action='store_true',
                        help='log this run to Notion ⏰ Search runs even without --send (the desktop app always does)')
    parser.add_argument('--insight', action='store_true',
                        help="scheduled mode: send the day's insight if it's due (insight mode always sends one)")
    args = parser.parse_args()
    if not 1 <= args.limit <= 50:
        parser.error('--limit must be between 1 and 50')
    apply_switches(args)
    tracker = notion.Tracker.from_env()
    # The app's check-first step (--propose) is a preview, not a run: no ⏱️ Search runs row (it once ended as
    # "Failed: ended before its report", toasting "had problems" for a good reading). Its cost is counted in the
    # confirmed step's run (--reading carries it).
    if tracker and (args.send or args.log_run) and not args.propose:
        cron_runs.auto_begin(tracker)  # the run's ⏱️ Search runs row opens when it starts
    if args.mode == 'import':
        # A link the search has not found: read it, score it, and add it to Job Matches as Open. Not an application.
        if not args.job or not tracker:
            raise SystemExit('--mode import requires --job <URL> and NOTION_TOKEN')
        run = new_cron_run('import')
        try:
            with store.connect(args.db) as db:
                outcome = import_url.run(db, tracker, _job_arg(args.job), stats=run)
            reply = outcome['line']
            if outcome.get('row') and outcome.get('created'):
                cron_runs.log_job(run, outcome['row'], True)
            run['subject'] = outcome.get('subject') or ''
        except ValueError as error:
            reply = f'⚠️ {error}'
            outcome = {}
        failed = reply.startswith('⚠️')
        run['headline'] = log_text(reply).split('\n')[0][:300]
        if not (failed and not cron_runs.total_usd(run)):
            log_ai_run(tracker, run, args, failed=failed)
        print(log_text(reply))
        return 1 if failed else 0
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
            messages, log = prepare_kit(db, _job_arg(args.job), tracker, stats=run['kits'], run=run)
        print(log)
        log_ai_run(tracker, run, args)
        print('\n\n'.join(messages))
        if args.send:
            credentials = telegram.credentials()
            for message in messages:
                telegram.send(message, *credentials)
        return 0
    if args.mode == 'add' and not args.job:
        # A pasted message or screenshot (/add <message>, a forward or photo sent to the bot, the app's Log box):
        # the job it's about is updated, or created (src/ai/inbox.py).
        if not tracker:
            raise SystemExit('--mode add requires NOTION_TOKEN')
        run = new_cron_run('add')
        run['mail'] = {}  # Haiku reading one message: counted with the mail check's cost
        found = {}  # the job it created or updated (inbox.log fills it)
        try:
            image = None
            files = [f for f in (args.file or '').split(',') if f]  # the app sends up to 5 screenshots, comma-separated
            if files and all(Path(f).is_file() for f in files):
                image = [inbox.load_image(f) for f in files[:inbox.MAX_IMAGES]]
            elif args.file:  # a photo or image file sent to the bot
                name, data = interviews.download(telegram.credentials()[0], args.file)
                image = (name, data, inbox.MEDIA.get(Path(name).suffix.lower(), 'image/jpeg'))
            # Where it was added: the app's Log box is the app even when its reply also goes to Telegram (--send).
            source = 'Job Pilotto app' if args.from_app else 'Telegram' if args.send else 'Manual'
            if args.propose:  # the app's step 1: nothing written; the proposal comes back to be confirmed
                # With --reading: the job you picked in the confirmation step (--target), for the same reading (no AI).
                earlier = json.loads(Path(args.reading).read_text(encoding='utf-8')) if args.reading else None
                proposal = inbox.propose(tracker, text=args.note or '', image=image, stats=run['mail'], target=args.target,
                                         item=earlier['item'] if earlier else None)
                print(json.dumps({'ok': True, **proposal, 'stats': (earlier.get('stats') or {}) if earlier else run['mail']}, default=str))
                return 0
            proposal = None
            if args.reading:  # step 2: what you confirmed replaces Claude's guesses; no second reading
                saved = json.loads(Path(args.reading).read_text(encoding='utf-8'))
                for key, value in (saved.pop('stats', None) or {}).items():  # the reading's cost counts in this run
                    run['mail'][key] = run['mail'].get(key, 0) + value if isinstance(value, (int, float)) else value
                proposal = inbox.confirm(saved, kind=args.kind, channel=args.channel, started=args.started,
                                         other=args.channel_other, interview_at=args.interview_at, company=args.company,
                                         agency=args.agency, last_at=args.last_at,
                                         first_contact=None if args.first_contact is None else args.first_contact == 'yes',
                                         agreed=None if args.agreed is None else args.agreed == 'yes', origin=args.origin)
            reply = escape(inbox.log(tracker, text=args.note or '', image=image, source=source,
                                     event_source='Job Pilotto app' if args.from_app else 'Telegram' if args.send else 'CLI',
                                     talking=args.action == 'talking', stats=run['mail'], target=args.target,
                                     on_new=added.hook(tracker, args.db, run), proposal=proposal, found=found))
            run['mail'].update(pending=1, done=1)
            queue_mail_check()
        except ValueError as error:
            reply = f'⚠️ {escape(str(error))}'
        failed = reply.startswith('⚠️')  # nothing was logged: the run says so ("had problems", not "done")
        if found.get('row') and not reply.startswith(('⚠️', 'ℹ️')):  # a job created or updated: the run links to it
            cron_runs.log_job(run, found['row'], found['created'])
        run['headline'] = log_text(reply).split('\n')[0][:300]  # the run's result line (⏱️ Search runs, Recent activity)
        # Turned away before any AI call (too short, no key): the dialog says why; that's no run, so no row.
        if not (failed and not cron_runs.total_usd(run)):
            log_ai_run(tracker, run, args, failed=failed)
        print(log_text(reply))  # the log (and the app) get plain text; Telegram gets the HTML
        if args.send:
            telegram.send(reply, *telegram.credentials())
        return 1 if failed else 0
    if args.mode == 'add':
        # /add <job URL> [date]: track an application made outside Job Pilotto.
        if not tracker:
            raise SystemExit('--mode add requires --job <URL> and NOTION_TOKEN')
        run = new_cron_run('add')
        found = {}  # the job it created or updated (ledger.add_application fills it)
        try:
            applied, approx = ledger.parse_applied(args.note)
            meta = ledger.page_meta(args.job)
            given = {'title': args.job_title, 'company': args.job_company, 'description': args.job_text}
            meta.update({key: value.strip() for key, value in given.items() if value and value.strip()})
            meta['company'] = ledger.company_for(tracker, args.job, meta)
            with store.connect(args.db) as db:
                # The same AI stages as a found job (facts, fit score) before the record is frozen: the fit columns
                # go on its Applications row (meta['application_columns'], no Job Matches row), so the application
                # record carries them too. AI trouble never blocks tracking it.
                fit = None
                try:
                    fit = added.process(db, tracker, args.job, meta, stats=run)
                except Exception as error:  # noqa: BLE001
                    print(f'Warning: AI stages skipped: {type(error).__name__}: {error}')
                reply = '📥 ' + escape(ledger.add_application(tracker, args.job, applied=applied, approx=approx,
                                                              source='Telegram', meta=meta, found=found, origin=args.origin))
                if fit:
                    reply += f' · {escape(fit)}'
                if ledger.no_fetch(args.job) and not meta.get('description'):
                    reply += ('\nℹ️ LinkedIn-type pages aren\'t read. For the fit score and facts, send me a screenshot of '
                              'the job posting too, or add it in the app with its text.')
                # The app's Jobs list shows it too, as Applied (the local cache of the Applications row just written).
                store.track_applied(db, args.job, meta)
            queue_mail_check()
        except ValueError as error:
            reply = f'⚠️ {escape(str(error))}'
        failed = reply.startswith('⚠️')  # nothing was logged: the run says so ("had problems", not "done")
        if found.get('row') and not reply.startswith(('⚠️', 'ℹ️')):  # a job created or updated: the run links to it
            cron_runs.log_job(run, found['row'], found['created'])
        run['headline'] = log_text(reply).split('\n')[0][:300]  # the run's result line (⏱️ Search runs, Recent activity)
        # Turned away before any AI call (too short, no key): the dialog says why; that's no run, so no row.
        if not (failed and not cron_runs.total_usd(run)):
            log_ai_run(tracker, run, args, failed=failed)
        print(log_text(reply))  # the log (and the app) get plain text; Telegram gets the HTML
        if args.send:
            telegram.send(reply, *telegram.credentials())
        return 1 if failed else 0
    if args.mode == 'interview':
        if not tracker:
            raise SystemExit('--mode interview requires NOTION_TOKEN')
        # Telegram only to send the summary or fetch a file sent to the bot; the app's reviews work without it.
        from_bot = bool(args.file) and not Path(args.file).is_file()
        token, chat_id = telegram.credentials() if args.send or from_bot else (None, None)
        sender = (lambda text: telegram.send(text, token, chat_id)) if args.send else None
        run = new_cron_run('interview')
        run['interview'] = {}
        reviewed = {}  # the job the interview is linked to, once known (interviews.run fills it)
        try:
            result = interviews.run(tracker, file_id=args.file, note=args.note, token=token, send=sender,
                                    stats=run['interview'], job_url=args.job, page_id=args.interview, found=reviewed)
            if reviewed.get('application'):
                run['application'] = reviewed['application']  # the run links to the job it was for
            run['subject'] = reviewed.get('title', '')  # the run's title names the interview ("Huxley · Recruiter screen")
            run['headline'] = result.split(' https://')[0]
            print(result)
            run['interview'].update(pending=1, done=1)
            # The Interviews page's insights follow each saved review (event-driven; skipped when nothing changed).
            # Its cost is on this run's row ('insight'); a failure there never fails the review.
            run['insight'] = {}
            if result.startswith('Interview analysed again'):  # "Review again" is one AI call; Refresh updates insights
                print('Interview insights: not refreshed after a review again (Refresh on the Interviews page)')
            else:
                print(interview_insights.after_review(tracker, stats=run['insight']))
            log_ai_run(tracker, run, args)
        except ValueError as error:  # the owner sent something that can't be analysed: say why
            print(error)
            if sender:
                sender(f'⚠️ {escape(str(error))}')
        except Exception as error:
            if not cost.limit_reached(error):
                raise
            run_url = f"{os.getenv('GITHUB_SERVER_URL', 'https://github.com')}/{os.getenv('GITHUB_REPOSITORY', '')}/actions/runs/{os.getenv('GITHUB_RUN_ID', '')}"
            message = cost.limit_message(error, 'the interview review', retry=(
                ' Your transcript is kept: after raising it, send it again, or re-run '
                f'<a href="{escape(run_url, quote=True)}">this run</a>.' if os.getenv('GITHUB_RUN_ID') else ''))
            print(message)
            if sender:
                sender(message)
        return 0
    if args.mode in ('insight', 'weekly'):
        if not tracker:
            raise SystemExit(f'--mode {args.mode} requires NOTION_TOKEN')
        sender = (lambda text, markup: telegram.send(text, *telegram.credentials(), markup)) if args.send else telegram.to_app
        with store.connect(args.db) as db:
            make = insights.run if args.mode == 'insight' else insights.weekly
            run = new_cron_run(args.mode)
            run['insight'] = {}
            try:
                run['headline'] = make(db, tracker, send=sender, stats=run['insight'],
                                       **({'force': True} if args.mode == 'insight' else {})) or \
                    ('No new insight: nothing worth saying today' if args.mode == 'insight' else 'Weekly report: nothing to report')
                run['subject'] = insights.category_of(run['headline']) if args.mode == 'insight' else ''
                print(run['headline'])
                log_ai_run(tracker, run, args)
            except Exception as error:
                if not cost.limit_reached(error):
                    raise
                message = cost.limit_message(error, f'the {args.mode} report')
                print(message)
                if args.send:
                    telegram.send(message, *telegram.credentials())
                else:
                    telegram.to_app(message)
                # Closed here as a warning that names the limit: left open, the end-of-process guard wrote the row as Failed ("Insight failed") while the run exited 0.
                reason = f'AI limit reached: {cost.limit_reason(error)}'
                print(reason)
                run['warnings'].append(reason)
                run['headline'] = f"{'Insight' if args.mode == 'insight' else 'Weekly report'} paused"
                log_ai_run(tracker, run, args)
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
            feed_list = scout.active_sources(db, tracker, sources, downloaded_index())
            if employer_index.problem:  # said on the run, not only in its log: the check then crawled a small list
                run['warnings'].append(f'Employer index not downloaded ({employer_index.problem}): this check crawled {len(feed_list)} feeds, not the full list')
            with feeds.database(DATA / 'jobs.sqlite') as feed_db:
                report = feeds.scan(feed_list, feed_db)
                crawl_funnel = report.get('funnel')   # not `funnel`: that name is the Notion funnel module used further down
                if crawl_funnel:   # the same fixed-list tags the pool uses (src/contribute.py): all that ever describes this search to the product
                    crawl_funnel['roles'], crawl_funnel['regions'] = contribute.tags()
                coverage.save(crawl_funnel)   # how much of the market the role keywords catch (Strategy page, and anonymous counts if reports are on)
                # Paid per search, so only full crawls use it; off without SERPAPI_API_KEY.
                if args.mode in ('scheduled', 'run') and google_jobs.api_key():
                    google = google_jobs.scan(feed_db, google_jobs.api_key(),
                                              google_jobs.settings(load_search_config()))
                    report['jobs'] += google['jobs']
                    report['sources'] += google['sources']
                # Aggregators with public APIs (src/sources/aggregators.py): free ones always, keyed ones with their keys; each at most every 6 hours.
                if args.mode in ('scheduled', 'run'):
                    from .sources import aggregators
                    found = aggregators.scan(feed_db, load_search_config())
                    report['jobs'] += found['jobs']
                    report['sources'] += found['sources']
                    # Job-alert emails in the user's own Gmail (src/sources/job_alerts.py): LinkedIn & co. without ever fetching their pages.
                    from . import features
                    from .ai import engine
                    if features.enabled('job_alerts') and engine.ready():
                        from .sources import google as google_api, job_alerts
                        gmail = google_api.Google.from_env()
                        if gmail:
                            alerts = job_alerts.scan(feed_db, gmail, engine.client(action='mail'))
                            report['jobs'] += alerts['jobs']
                            report['sources'] += alerts['sources']
            from .ai import cost as ai_cost
            if ai_cost.SIDE:   # careers pages, link picks and alert emails read with AI during this crawl: part of the run's AI cost
                run['sources'] = dict(ai_cost.SIDE)
            imported = store.import_watch_report(db, report)
            run.update(crawl_counts(report, imported))
            if args.mode in ('scheduled', 'run'):
                try:  # opt-in and at most daily (src/contribute.py); the pool never affects a run
                    contribute.maybe_send(feed_list, report, tracker)
                except Exception as error:  # noqa: BLE001
                    print(f'Warning: pool contribution skipped: {type(error).__name__}: {error}')
            if args.mode in ('scheduled', 'run'):
                # Only full crawls can tell that a job disappeared.
                run['closed_stale'] = store.close_stale(db, STALE_DAYS)
                print(f"Closed {run['closed_stale']} job(s) not seen for {STALE_DAYS} days")
        if args.mode != 'more' and args.company_report.exists():
            company_report = json.loads(args.company_report.read_text())
            imported += store.import_company_report(db, company_report)
        # Jobs that came without a description (SmartRecruiters' list, a jobs.ch page that failed) get it now, or
        # they'd never be enriched or scored. A few per run; a failure is tried again next run.
        try:
            note = describe.backfill(db)
            if note:
                print(note)
        except Exception as error:
            print(f'Warning: description backfill skipped: {type(error).__name__}: {error}')
        if args.enrich_max:
            # Runs after import so fresh descriptions are included. AI trouble never blocks the digest.
            try:
                run['enrich'] = {}
                print(enrich.run(db, enrich.DEFAULT_MODEL, args.enrich_max, stats=run['enrich']))
                run['warnings'] += left_out(run['enrich'], 'read by AI')
            except Exception as error:
                print(f'Warning: enrichment skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'enrichment skipped: {type(error).__name__}')
        if args.score_max and (tracker or local_profile()):
            # Scores only jobs that survive the hard filters; the Profile is re-read every run
            # (the desktop app's local Profile file when set, else the Notion page).
            try:
                profile = local_profile() or tracker.page_text()
                candidates, _ = digest.eligible_jobs(db, hidden)
                run['score'] = {}
                print(score.run(db, candidates, profile, score.DEFAULT_MODEL, args.score_max, stats=run['score']))
                run['warnings'] += left_out(run['score'], 'scored')
            except Exception as error:
                print(f'Warning: scoring skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'scoring skipped: {type(error).__name__}')
        if tracker and args.mode in ('scheduled', 'run', 'today'):
            # Mirror scored jobs into Notion "Job Matches"; a Notion problem never blocks the digest.
            try:
                scored = for_job_matches(db, hidden)
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
            # A recorded interview whose application still says Interview scheduled (saved before the app moved it on).
            try:
                print(interviews.sweep(tracker))
            except Exception as error:
                print(f'Warning: interview sweep skipped: {type(error).__name__}: {error}')
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
    if sys.stdout.isatty():  # the Telegram HTML is a preview for a terminal; the app's log gets a summary line
        print(text)
    if not args.send:
        if not sys.stdout.isatty():
            telegram.to_app(text)  # the desktop app shows the list itself
        print('\n' + digest_note(len(shown_ids), new_count, terminal=sys.stdout.isatty()))
        if args.mode in ('scheduled', 'run', 'today'):
            save_run(run)  # the desktop app's activity bar shows its counts
            if tracker and args.log_run:
                log_crawl(tracker, run)
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
    if args.mode in ('scheduled', 'run', 'today'):
        save_run(run)
        if tracker:  # sending runs; a terminal preview (no --send) isn't logged unless --log-run
            log_crawl(tracker, run)
    return 0


if __name__ == '__main__':
    main()
