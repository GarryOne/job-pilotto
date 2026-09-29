"""Notion "⏰ Cronjob Runs": one row per scheduled pipeline run, with its cost and a mini-report.

`daily.main()` fills a run dict as it goes (crawl counts, per-stage AI stats from enrich/score/kit,
Job Matches sync, Telegram outcome, warnings) and hands it to `log_run` at the end. The report is
written by code from those numbers, so it costs nothing; a Notion failure never fails the run.
"""
import atexit
from collections import deque
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from html import unescape
import os
import re
import sys

CRON_RUNS_DATABASE_ID = os.getenv('NOTION_CRON_RUNS_DB', '')
# (run key, the old per-step column (retired: each step's cost is on the run's page now), its label).
STAGES = (('enrich', 'Cost enrich (USD)', 'Enriched'), ('score', 'Cost score (USD)', 'Scored'),
          ('kits', 'Cost kits (USD)', 'Kits'), ('insight', 'Cost insight (USD)', 'Insights'),
          ('interview', 'Cost interview (USD)', 'Interviews'), ('mail', 'Cost mail (USD)', 'Emails'))


def new_run(mode):
    """The run dict an AI job fills for its ⏰ Cronjob Runs row; trigger and link come from GitHub Actions.
    Every AI job logs one (crawls, kits, insights, interviews, mail), so the rows add up to the month's spend."""
    event = os.getenv('GITHUB_EVENT_NAME', '')
    # The desktop app says what started it (JOB_PILOTTO_TRIGGER: "Mac schedule" or "Mac (you)").
    trigger = os.getenv('JOB_PILOTTO_TRIGGER') or {'schedule': 'Schedule', '': 'Local'}.get(event, 'Manual')
    run = {'mode': mode, 'started_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
           'trigger': trigger, 'warnings': []}
    if os.getenv('GITHUB_RUN_ID'):
        run['run_url'] = (f"{os.getenv('GITHUB_SERVER_URL', 'https://github.com')}/"
                          f"{os.getenv('GITHUB_REPOSITORY', '')}/actions/runs/{os.getenv('GITHUB_RUN_ID')}")
    if _auto.get('tracker') and mode in LOGGED_MODES and not _open.get('run'):
        begin(_auto['tracker'], run)
    return run


# The jobs that always end with a row (log_run), so opening one at the start is safe (see begin()).
LOGGED_MODES = {'scheduled', 'run', 'today', 'prepare', 'add', 'interview', 'insight', 'weekly', 'mail', 'rejection', 'scout', 'prep'}
_auto = {}


def auto_begin(tracker):
    """This process logs its run: the next new_run() opens the row at once (Status Running)."""
    _auto['tracker'] = tracker


def _text(value):
    return {'rich_text': [{'text': {'content': value[:2000]}}]} if value else {'rich_text': []}


def _para(content, kind='paragraph'):
    return {'object': 'block', 'type': kind, kind: {'rich_text': [{'text': {'content': content[:2000]}}]}}


def total_usd(run):
    return sum((run.get(stage) or {}).get('usd', 0.0) for stage, _, _ in STAGES)


def total_tokens(run):
    return sum((run.get(stage) or {}).get(key, 0) for stage, _, _ in STAGES
               for key in ('tokens_in', 'tokens_out', 'cache_read'))


def status(run):
    if run.get('warnings') or run.get('feed_errors'):
        return 'Warnings'
    if run.get('headline'):
        return 'OK'
    if run.get('mode') in ('mail', 'rejection'):
        return 'OK' if run.get('updates') else 'Quiet'
    return 'OK' if run.get('new') or run.get('changed') else 'Quiet'


def mail_lines(run):
    """A Gmail check: what it read and each update it recorded in the application ledger."""
    info = run.get('mail') or {}
    updates = run.get('updates') or []
    lines = [f"Gmail check: {info.get('done', 0)} new email(s) read, {len(updates)} update(s) recorded; "
             f"AI cost ${total_usd(run):.3f}."]
    lines += updates
    lines += [f'Warning: {w}' for w in run.get('warnings', [])]
    return lines


# One-off jobs (not crawls): their name when they finish without a result line of their own.
ONE_OFF = {'add': 'Logged activity', 'insight': 'Insight', 'weekly': 'Weekly report', 'interview': 'Interview review',
           'prepare': 'Application kit', 'apply': 'Marked applied', 'scout': 'Find employers', 'prep': 'Interview prep kit'}


def report_lines(run):
    """The mini-report: a headline, then what stood out, most useful first."""
    if run.get('headline'):  # a one-off job (insight, weekly report, find employers…) says what it did
        return [f"{run['headline']} (AI cost ${total_usd(run):.3f})"] + [f'Warning: {w}' for w in run.get('warnings', [])]
    if run.get('mode') == 'mail':
        return mail_lines(run)
    if run.get('mode') in ONE_OFF:  # a one-off job without a result line: say which job, never a crawl's summary
        return [f"{ONE_OFF[run['mode']]} done (AI cost ${total_usd(run):.3f})"] + [f'Warning: {w}' for w in run.get('warnings', [])]
    if run.get('mode') == 'rejection':  # its AI cost is kept under "insight" (a review of your own search)
        return [f"Rejection review: {len(run.get('updates') or [])} application(s); AI cost ${total_usd(run):.3f}."] + \
            list(run.get('updates') or []) + [f'Warning: {w}' for w in run.get('warnings', [])]
    new, changed = run.get('new', 0), run.get('changed', 0)
    feeds, errors = run.get('feeds', 0), run.get('feed_errors', 0)
    cost = total_usd(run)
    lines = [f'{new} new and {changed} changed job(s) from {feeds} feed(s); AI cost ${cost:.3f}.'
             if new or changed else f'Quiet run: nothing new from {feeds} feed(s); AI cost ${cost:.3f}.']
    for title, company, score in run.get('top_new', [])[:3]:
        lines.append(f'Top new match: {title} at {company} (score {score}).')
    kits = run.get('kits') or {}
    if kits.get('done'):
        lines.append(f"Drafted {kits['done']} application kit(s): {', '.join(run.get('kit_titles', [])[:5])}.")
    for stage, _, label in STAGES:
        info = run.get(stage) or {}
        if info.get('failed'):
            lines.append(f"{label}: {info['failed']} of {info.get('pending', '?')} call(s) failed.")
        if info.get('pending') and info.get('done', 0) < info['pending'] and not info.get('failed'):
            lines.append(f"{label}: stopped at {info.get('done', 0)} of {info['pending']} (API unavailable).")
    scored = (run.get('score') or {}).get('done', 0)
    if scored:
        lines.append(f"Scoring cost ${(run['score'].get('usd', 0) / scored):.4f} per job.")
    if errors:
        failing = ', '.join(run.get('failing_feeds', [])[:6])
        lines.append(f'{errors} feed(s) failed: {failing}.')
    if run.get('closed_stale'):
        lines.append(f"Closed {run['closed_stale']} job(s) not seen for a week.")
    lines += [f'Warning: {w}' for w in run.get('warnings', [])]
    return lines


# A jobs check crawls feeds; its counters (feeds, new, changed…) mean nothing on other runs, so those stay empty.
CRAWL_MODES = {'scheduled', 'run', 'today'}
NAMES = {'scheduled': 'Jobs check', 'run': 'Jobs check', 'today': "Today's list", 'mail': 'Gmail check', 'rejection': 'Rejection review'}
TZ = ZoneInfo(os.getenv('JOB_PILOTTO_TZ', 'Europe/Zurich'))


def title(run):
    """'2026-09-29 16:02 · Interview prep kit · Huxley': local time (as Started shows it), what ran, about what."""
    try:
        at = datetime.fromisoformat(run['started_at']).astimezone(TZ).strftime('%Y-%m-%d %H:%M')
    except (KeyError, ValueError):
        at = str(run.get('started_at', ''))[:16].replace('T', ' ')
    name = NAMES.get(run['mode']) or ONE_OFF.get(run['mode']) or run['mode']
    return ' · '.join(part for part in (at, name, run.get('subject')) if part)[:200]


def run_page(run):
    """(properties, children) for one Cronjob Runs row. The core columns every run fills; the rest belong to one kind
    of run and stay empty on the others (hidden in Notion): a jobs check's crawl numbers, a Gmail check's emails, the
    Application a one-job run was for. Each AI step (model, tokens, cost), the report and the log are on the page."""
    lines = report_lines(run)
    crawl, mail = run['mode'] in CRAWL_MODES, run['mode'] == 'mail'
    only = lambda applies, value: {'number': value if applies else None}
    properties = {
        'Run': {'title': [{'text': {'content': title(run)}}]},
        'Started': {'date': {'start': run['started_at']}},
        'Duration (s)': {'number': run.get('seconds')},
        'Mode': {'select': {'name': run['mode']}},
        'Trigger': {'select': {'name': run.get('trigger', 'Local')}},
        'Status': {'select': {'name': status(run)}},
        'AI cost (USD)': {'number': round(total_usd(run), 4)},
        'Tokens (total)': {'number': total_tokens(run)},
        'Telegram': _text(run.get('telegram', '')),
        'Summary': _text(lines[0]),
        # A jobs check
        'Feeds': only(crawl, run.get('feeds', 0)),
        'Feed errors': only(crawl, run.get('feed_errors', 0)),
        'New jobs': only(crawl, run.get('new', 0)),
        'Changed jobs': only(crawl, run.get('changed', 0)),
        'Closed stale': only(crawl, run.get('closed_stale', 0)),
        'Scored': only(crawl, (run.get('score') or {}).get('done', 0)),
        'Kits': only(crawl or run['mode'] == 'prepare', (run.get('kits') or {}).get('done', 0)),
        'Top new score': only(crawl and run.get('top_new'), run['top_new'][0][2] if run.get('top_new') else None),
        # A Gmail check
        'Emails': only(mail, (run.get('mail') or {}).get('done', 0)),
        'Updates': only(mail, len(run.get('updates') or [])),
    }
    if run.get('application'):  # a run about one job (prep kit, application kit, interview review): its Applications row
        properties['Application'] = {'relation': [{'id': run['application']}]}
    if run.get('run_url'):
        properties['Run URL'] = {'url': run['run_url']}
    children = [_para('Report', 'heading_3')] + [_para(line, 'bulleted_list_item') for line in lines]
    children.append(_para('Stages', 'heading_3'))
    for stage, _, label in STAGES:
        info = run.get(stage)
        if info:
            done = f": {info.get('done', 0)} of {info.get('pending', 0)}" if info.get('pending') else ''  # no "0 of 0"
            children.append(_para(
                f"{ONE_OFF.get(run['mode'], label) if not info.get('pending') else label} with {info.get('model', '?')}{done}; "
                f"tokens in {info.get('tokens_in', 0)} (+{info.get('cache_read', 0)} cached), "
                f"out {info.get('tokens_out', 0)}; ${info.get('usd', 0.0):.4f}", 'bulleted_list_item'))
    if run.get('matches'):
        children.append(_para(f"Job Matches: {run['matches']}", 'bulleted_list_item'))
    return properties, children[:95]


# Notion is where every run's history lives, wherever it ran (this Mac, GitHub, a Telegram button): the row
# appears when the job starts (Status Running), and at the end holds the report, what the job produced (the
# message it sent or showed) and the last lines of its output. The app, Telegram and Notion all read these rows.
LOG_LINES = 80
_output = deque(maxlen=LOG_LINES)
_open = {}  # the row this process opened with begin(): {'tracker', 'id', 'url', 'run'}


class _Tee:
    """stdout/stderr, also kept (last lines) for the run's page."""
    def __init__(self, stream):
        self.stream, self.partial = stream, ''

    def write(self, text):
        self.partial += text
        *lines, self.partial = self.partial.split('\n')
        lines = [line for line in lines if line.strip()]
        _output.extend(lines)
        if lines:
            _progress(lines[-1])
        return self.stream.write(text)

    def __getattr__(self, name):
        return getattr(self.stream, name)


def capture():
    if not isinstance(sys.stdout, _Tee):
        sys.stdout, sys.stderr = _Tee(sys.stdout), _Tee(sys.stderr)


def begin(tracker, run):
    """Open the run's row now (Status Running), so a job in progress shows everywhere; log_run() completes it.
    Returns its URL, or None (never raises)."""
    capture()
    if not tracker or not CRON_RUNS_DATABASE_ID:
        return None
    try:
        properties = {key: value for key, value in run_page(run)[0].items()
                      if key in ('Run', 'Started', 'Mode', 'Trigger', 'Run URL')}
        properties['Status'] = {'select': {'name': 'Running'}}
        page = tracker._request('POST', 'pages', {'parent': {'database_id': CRON_RUNS_DATABASE_ID}, 'properties': properties})
        _open.update(tracker=tracker, id=page['id'], url=page.get('url'), run=run)
        print(f"Cronjob run logged: {page.get('url')}")  # the desktop app links its activity row to this
        return page.get('url')
    except Exception as error:
        print(f'Warning: cronjob run not opened in Notion: {type(error).__name__}: {error}')
        return None


STEP_EVERY = 10  # seconds between progress updates of a running row
_last_step = {'at': 0.0}


def _progress(line):
    """A running job's latest output line as its row's Summary (⏳ …), at most every STEP_EVERY seconds, so a
    job running elsewhere (GitHub, a Telegram button) shows some progress in the app and in Notion."""
    import time
    if not _open.get('run') or len(line) > 160 or line.startswith(('Warning', ' ', 'Cronjob run logged', '<<<', 'message>>>')):
        return
    now = time.monotonic()
    if now - _last_step['at'] < STEP_EVERY:
        return
    _last_step['at'] = now
    try:
        _open['tracker']._request('PATCH', f"pages/{_open['id']}", {'properties': {'Summary': _text(f'⏳ {line}')}})
    except Exception:  # noqa: BLE001 - progress is best effort
        pass


def plain(html):
    """A Telegram HTML message as plain text; a link keeps its address after its words ("Title (https://…)"), as the
    app's Recent activity reads each job's link from it."""
    linked = re.sub(r'<a\s+href="([^"]+)"[^>]*>(.*?)</a>', lambda m: f'{m.group(2)} ({unescape(m.group(1))})', html, flags=re.S)
    return unescape(re.sub(r'<[^>]+>', '', linked)).strip()


def extra_blocks(messages, lines):
    """What the run produced (its last message) and a toggle with the last lines of its output."""
    blocks = []
    if messages:
        blocks.append(_para('Result', 'heading_3'))
        blocks += [_para(line) for line in plain(messages[-1]).split('\n') if line.strip()][:40]
    if lines:
        chunks = ['\n'.join(list(lines)[i:i + 25]) for i in range(0, len(lines), 25)]
        blocks.append({'object': 'block', 'type': 'toggle', 'toggle': {
            'rich_text': [{'text': {'content': f'Technical log (last {len(lines)} lines)'}}],
            'children': [{'object': 'block', 'type': 'code', 'code': {'language': 'plain text',
                          'rich_text': [{'text': {'content': chunk[:2000]}}]}} for chunk in chunks]}})
    return blocks


def _without_missing(send, properties):
    """send(properties); when Notion refuses a column this workspace doesn't have yet (the code is newer than its
    schema: a GitHub run before the app's schema repair), drop that column and send again, so the row is never lost."""
    for _ in range(5):
        try:
            return send(properties)
        except Exception as error:  # noqa: BLE001 — only a missing column is retried
            missing = re.search(r'([^:.\n]+?) is not a property that exists', str(error))
            if not missing or missing.group(1).strip() not in properties:
                raise
            properties = {k: v for k, v in properties.items() if k != missing.group(1).strip()}
    return send(properties)


def log_run(tracker, run, failed=False):
    """Complete the row begin() opened (or create it); returns its URL, or None when Notion refuses (never raises)."""
    from .. import telegram
    try:
        properties, children = run_page(run)
        if failed:
            properties['Status'] = {'select': {'name': 'Failed'}}
        children = children[:50] + extra_blocks(telegram.MESSAGES, list(_output))
        if _open.get('id') and _open.get('run') is run:
            _open.pop('run')
            _without_missing(lambda props: tracker._request('PATCH', f"pages/{_open['id']}", {'properties': props}), properties)
            tracker._request('PATCH', f"blocks/{_open['id']}/children", {'children': children[:100]})
            return _open.get('url')
        page = _without_missing(lambda props: tracker._request('POST', 'pages', {'parent': {'database_id': CRON_RUNS_DATABASE_ID},
                                                                                'properties': props, 'children': children[:100]}), properties)
        return page.get('url')
    except Exception as error:
        print(f'Warning: cronjob run not logged to Notion: {type(error).__name__}: {error}')
        return None


@atexit.register
def _unfinished():
    """A job that ended before reporting (a crash, an early exit): its row says so instead of staying Running."""
    if _open.get('run'):
        run = _open['run']
        run['warnings'] = list(run.get('warnings') or []) + ['ended before its report (see the technical log)']
        log_run(_open['tracker'], run, failed=True)
