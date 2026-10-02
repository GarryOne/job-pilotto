"""Notion "⏰ Cronjob Runs": one row per scheduled pipeline run, with its cost and a mini-report.

`daily.main()` fills a run dict as it goes (crawl counts, per-stage AI stats from enrich/score/kit,
Job Matches sync, Telegram outcome, warnings) and hands it to `log_run` at the end. The report is
written by code from those numbers, so it costs nothing; a Notion failure never fails the run.
"""
import atexit
import signal
import json
from collections import deque
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from html import unescape
import os
import re
import sys

from .. import run_result

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
           'trigger': trigger, 'warnings': [], 'run_id': run_result.current_id()}
    if os.getenv('GITHUB_RUN_ID'):
        run['run_url'] = (f"{os.getenv('GITHUB_SERVER_URL', 'https://github.com')}/"
                          f"{os.getenv('GITHUB_REPOSITORY', '')}/actions/runs/{os.getenv('GITHUB_RUN_ID')}")
    if _auto.get('tracker') and mode in LOGGED_MODES and not _open.get('run'):
        begin(_auto['tracker'], run)
    return run


# The jobs that always end with a row (log_run), so opening one at the start is safe (see begin()).
LOGGED_MODES = {'scheduled', 'run', 'today', 'prepare', 'add', 'interview', 'insight', 'weekly', 'mail', 'rejection', 'scout', 'prep', 'import'}
_auto = {}


def auto_begin(tracker):
    """This process logs its run: the next new_run() opens the row at once (Status Running)."""
    _auto['tracker'] = tracker


def _text(value):
    return {'rich_text': [{'text': {'content': value[:2000]}}]} if value else {'rich_text': []}


def _para(content, kind='paragraph'):
    return {'object': 'block', 'type': kind, kind: {'rich_text': [{'text': {'content': content[:2000]}}]}}


def _linked(link, content, kind='bulleted_list_item'):
    """A line whose first words open `link` (on a run's page: an email's subject opens that email in Gmail)."""
    rich = ([{'text': {'content': content[:2000], 'link': {'url': link}}}] if link
            else [{'text': {'content': content[:2000]}}])
    return {'object': 'block', 'type': kind, kind: {'rich_text': rich}}


def _sender(value):
    """The sender as a run's page shows it, never a full address: the name when there is one, else the domain
    ("no-reply@us.greenhouse-mail.io" -> "us.greenhouse-mail.io")."""
    name = re.sub(r'\s*<[^>]*>\s*', '', value or '').strip().strip('"')
    address = re.search(r'[\w.+-]+@([\w.-]+)', value or '')
    if name and '@' not in name:
        return name[:60]
    return address.group(1) if address else (value or '')[:60]


def _clock(value):
    """An email's time as this workspace shows every other time (its own time zone)."""
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).astimezone(TZ).strftime('%d %b %H:%M')
    except (TypeError, ValueError):
        return str(value or '')[:16]


# What each action means in words on the run's page: "recorded" is the one that changes an application.
EMAIL_ACTION = {'recorded': 'recorded', 'asked': 'needs you', 'tracked': 'tracked a new job',
                'skipped': 'not about your applications', 'duplicate': 'already known', 'reviewed': 'read'}


def email_lines(run):
    """Every email a Gmail check read: its subject (a link that opens it in Gmail), the sender, the time, what the check
    concluded, and what it did — recorded, asked about, tracked, skipped, already known. This is the evidence behind a
    check's "N update(s) recorded": before, a run's page said how many, never which, and never what changed."""
    lines = []
    for email in run.get('emails') or []:
        head = f"{email.get('subject') or '(no subject)'} · {_sender(email.get('from'))} · {_clock(email.get('at'))}"
        what = EMAIL_ACTION.get(email.get('action'), email.get('action') or '')
        parts = [f"[{what}]"]
        label = str(email.get('label') or '')
        if label and label.lower() != what.lower():  # "not about your applications" is not said twice
            parts.append(label)
        if email.get('changes'):
            # "changed nothing to record" reads badly: the negative note stands on its own.
            parts.append(email['changes'] if email['changes'].startswith('nothing') else f"changed {email['changes']}")
        lines.append((email.get('link') or '', f"{head} — {' · '.join(parts)}"))
    return lines


def total_usd(run):
    return sum((run.get(stage) or {}).get('usd', 0.0) for stage, _, _ in STAGES)


def total_tokens(run):
    return sum((run.get(stage) or {}).get(key, 0) for stage, _, _ in STAGES
               for key in ('tokens_in', 'tokens_out', 'cache_read'))


def billed_to(run):
    """How the run's AI was paid for (the "Billed to" column): the user's Claude Code on their Claude plan
    (src/ai/engine.py), their API key, both (a fallback), or None when no AI ran."""
    cli = any((run.get(stage) or {}).get('cli_calls') for stage, _, _ in STAGES)
    api = any((run.get(stage) or {}).get('api_calls') for stage, _, _ in STAGES)
    return 'Both' if cli and api else 'Claude subscription' if cli else 'Anthropic API credits' if api else None


def cost_text(run):
    """The run's AI cost in words: dollars for the API, "Claude Code, your plan" for the subscription."""
    billed, usd = billed_to(run), f'AI cost ${total_usd(run):.3f}'
    return 'Claude Code, your plan' if billed == 'Claude subscription' else f'{usd} + Claude Code' if billed == 'Both' else usd


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
             f"{cost_text(run)}."]
    lines += updates
    lines += [f'Warning: {w}' for w in run.get('warnings', [])]
    return lines


# One-off jobs (not crawls): their name when they finish without a result line of their own.
ONE_OFF = {'add': 'Logged activity', 'insight': 'Insight', 'weekly': 'Weekly report', 'interview': 'Interview review',
           'prepare': 'Application kit', 'apply': 'Marked applied', 'scout': 'Find employers', 'prep': 'Interview prep kit'}
# A job whose AI step has no queue needs a verb, not a column's label: the "Stages" line of a Gmail check.
STEP_NAME = {'mail': 'Read job emails'}


def report_lines(run):
    """The mini-report: a headline, then what stood out, most useful first."""
    if run.get('headline'):  # a one-off job (insight, weekly report, find employers…) says what it did
        return [f"{run['headline']} ({cost_text(run)})"] + [f'Warning: {w}' for w in run.get('warnings', [])]
    if run.get('mode') == 'mail':
        return mail_lines(run)
    if run.get('mode') in ONE_OFF:  # a one-off job without a result line: say which job, never a crawl's summary
        return [f"{ONE_OFF[run['mode']]} done ({cost_text(run)})"] + [f'Warning: {w}' for w in run.get('warnings', [])]
    if run.get('mode') == 'rejection':  # its AI cost is kept under "insight" (a review of your own search)
        return [f"Rejection review: {len(run.get('updates') or [])} application(s); {cost_text(run)}."] + \
            list(run.get('updates') or []) + [f'Warning: {w}' for w in run.get('warnings', [])]
    new, changed = run.get('new', 0), run.get('changed', 0)
    feeds, errors = run.get('feeds', 0), run.get('feed_errors', 0)
    cost = cost_text(run)
    lines = [f'{new} new and {changed} changed job(s) from {feeds} feed(s); {cost}.'
             if new or changed else f'Quiet run: nothing new from {feeds} feed(s); {cost}.']
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
    if scored and (run.get('score') or {}).get('usd'):
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
# The row's kind, the second part of its title (its Mode column keeps the raw mode; nothing matches rows by title).
KINDS = {'scheduled': 'Jobs check', 'run': 'Jobs check', 'today': 'Jobs check', 'mail': 'Gmail check', 'scout': 'Find employers',
         'add': 'Log activity', 'interview': 'Interview review', 'prepare': 'Application kit', 'prep': 'Interview prep',
         'rejection': 'Rejection review', 'insight': 'Insight', 'weekly': 'Weekly report', 'import': 'Add a job'}
TZ = ZoneInfo(os.getenv('JOB_PILOTTO_TZ', 'Europe/Zurich'))
SUBJECT_MAX = 60


def counted(n, one, many=None, none='nothing new'):
    """'1 new job', '12 new jobs', or `none` for 0."""
    return f"{n} {one if n == 1 else many or one + 's'}" if n else none


def job_subject(row=None, company='', role='', via=''):
    """What a one-job run was about: "Company — Role" ("via Agency — Role" when only the agency is known), from its
    Applications row (a Notion page or its properties) or the given names. The role without a generated " · Company" /
    " · via Agency" suffix (titles.role_of), so the employer is never named twice."""
    from . import titles
    if row:
        props = row.get('properties', row) or {}
        company, via = titles.text_value(props.get('Company')), titles.text_value(props.get('Via'))
        role = titles.row_role(row)
    else:
        role = titles.role_of(role, company, via)
    who = titles.named(company) or (titles.VIA + titles.named(via) if titles.named(via) else '')
    return ' — '.join(part for part in (who, (role or '').strip()) if part)


def subject(run):
    """What the run was about, in a few words: set by the job itself (a job's "Company — Role", an interview's title, an
    insight's category), else from the run's own numbers (a jobs check's new jobs, a Gmail check's updates). '' when
    there's nothing to say (a weekly report). Never an email address or anything not already in Notion."""
    text = run.get('subject') or ''
    if not text and run.get('mode') in CRAWL_MODES and 'new' in run:
        text = counted(run['new'], 'new job')
    elif not text and run.get('mode') == 'mail' and 'mail' in run:
        updates, emails = len(run.get('updates') or []), (run.get('mail') or {}).get('done', 0)
        text = counted(updates, 'update') if updates else counted(emails, 'email checked', 'emails checked', 'no updates')
    text = ' '.join(str(text).split())
    return text if len(text) <= SUBJECT_MAX else text[:SUBJECT_MAX - 1].rstrip(' ,·-–—/|(') + '…'


def title(run, final=True):
    """'2026-09-29 16:02 · Interview prep · Huxley — Principal SRE': local time (as Started shows it), what ran, about
    what. The subject is known at the end: a row opened at the start (final=False) or a run that failed keeps
    'date · Kind'."""
    try:
        at = datetime.fromisoformat(run['started_at']).astimezone(TZ).strftime('%Y-%m-%d %H:%M')
    except (KeyError, ValueError):
        at = str(run.get('started_at', ''))[:16].replace('T', ' ')
    name = run.get('name') or KINDS.get(run['mode']) or ONE_OFF.get(run['mode']) or run['mode']  # a job may name itself
    return ' · '.join(part for part in (at, name, subject(run) if final else '') if part)[:200]


JOB_LINE = 'Job logged: '


def log_job(run, row, created):
    """A run that created or updated one job (a logged message, an application added from elsewhere): the run's
    Application relation, and a "Job logged: {…}" line in its output, from which the app links to that job (the
    run's detail in Recent activity, the Log box's result). Returns the job: page_id, url (its Notion page), title,
    job_url (the Jobs list's key), created (a new job, not an update of one you had)."""
    props = row.get('properties') or {}
    title = ''.join(part.get('plain_text') or (part.get('text') or {}).get('content', '')
                    for part in (props.get('Job') or {}).get('title') or [])
    job = {'page_id': row['id'], 'url': row.get('url') or f"https://www.notion.so/{row['id'].replace('-', '')}",
           'title': title, 'job_url': (props.get('Job URL') or {}).get('url') or '', 'created': bool(created)}
    run['application'] = row['id']
    run['subject'] = job_subject(row)  # the run's title names the job
    run_result.note_job(job)
    print(JOB_LINE + json.dumps(job, ensure_ascii=False))
    return job


def run_page(run, final=True):
    """(properties, children) for one Cronjob Runs row. The core columns every run fills; the rest belong to one kind
    of run and stay empty on the others (hidden in Notion): a jobs check's crawl numbers, a Gmail check's emails, the
    Application a one-job run was for. Each AI step (model, tokens, cost), the report and the log are on the page.
    final: the end-of-run write, whose title names what the run was about (title())."""
    lines = report_lines(run)
    crawl, mail = run['mode'] in CRAWL_MODES, run['mode'] == 'mail'
    only = lambda applies, value: {'number': value if applies else None}
    properties = {
        'Run': {'title': [{'text': {'content': title(run, final)}}]},
        'Started': {'date': {'start': run['started_at']}},
        'Duration (s)': {'number': run.get('seconds')},
        'Mode': {'select': {'name': run['mode']}},
        'Trigger': {'select': {'name': run.get('trigger', 'Local')}},
        'Status': {'select': {'name': status(run)}},
        'AI cost (USD)': {'number': round(total_usd(run), 4)},
        'Tokens (total)': {'number': total_tokens(run)},
        'Billed to': {'select': {'name': billed_to(run)} if billed_to(run) else None},
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
    if run.get('application'):  # a run about one job (prep kit, logged activity, interview review): its Applications row
        properties['Application'] = {'relation': [{'id': run['application']}]}
    if run.get('run_url'):
        properties['Run URL'] = {'url': run['run_url']}
    if run.get('run_id'):  # joins this row to logs/app.log, logs/engine.log, and the Actions log
        properties['Run id'] = _text(str(run['run_id']))
    children = [_para('Report', 'heading_3')] + [_para(line, 'bulleted_list_item') for line in lines]
    read = email_lines(run)
    if read:  # every email this check read, its subject linking to it, and what the check did about it
        children.append(_para('Emails read', 'heading_3'))
        children += [_linked(link, line) for link, line in read[:40]]
    children.append(_para('Stages', 'heading_3'))
    for stage, _, label in STAGES:
        info = run.get(stage)
        if info:
            done = f": {info.get('done', 0)} of {info.get('pending', 0)}" if info.get('pending') else ''  # no "0 of 0"
            # The step's name when it has a queue (or the job's own name), else what it read: "Read job emails with
            # claude-haiku-4-5", never "Emails with claude-haiku-4-5" (1 Oct 2026).
            queued = info.get('pending')
            heading = label if queued else (run.get('name') or STEP_NAME.get(run['mode']) or ONE_OFF.get(run['mode'], label))
            children.append(_para(
                f"{heading} with {info.get('model', '?')}{done}; "
                f"tokens in {info.get('tokens_in', 0)} (+{info.get('cache_read', 0)} cached), "
                f"out {info.get('tokens_out', 0)}; "
                + ('Claude Code, your plan' if info.get('cli_calls') and not info.get('api_calls') else f"${info.get('usd', 0.0):.4f}"),
                'bulleted_list_item'))
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
        properties = {key: value for key, value in run_page(run, final=False)[0].items()
                      if key in ('Run', 'Started', 'Mode', 'Trigger', 'Run URL', 'Run id')}
        properties['Status'] = {'select': {'name': 'Running'}}
        page = _without_missing(lambda props: tracker._request(
            'POST', 'pages', {'parent': {'database_id': CRON_RUNS_DATABASE_ID}, 'properties': props}), properties)
        _open.update(tracker=tracker, id=page['id'], url=page.get('url'), run=run)
        run_result.note_notion(page.get('url'))
        print(f"Cronjob run logged: {page.get('url')}")  # the desktop app links its activity row to this
        return page.get('url')
    except Exception as error:
        print(f'Warning: cronjob run not opened in Notion: {type(error).__name__}: {error}')
        return None


def attach(blocks):
    """Add blocks (a log's screenshots) to the row begin() opened, while its run is going. Returns that row's URL, or None
    when no row is open or Notion refuses (the caller keeps them elsewhere). Never raises."""
    if not blocks or not _open.get('id') or not _open.get('tracker'):
        return None
    try:
        _open['tracker']._request('PATCH', f"blocks/{_open['id']}/children", {'children': blocks[:100]})
        return _open.get('url') or ''
    except Exception as error:  # noqa: BLE001
        print(f'Warning: not added to the run: {type(error).__name__}: {error}', file=sys.stderr)
        return None


STEP_EVERY = 10  # seconds between progress updates of a running row
_last_step = {'at': 0.0}


def _progress(line):
    """A running job's latest output line as its row's Summary (⏳ …), at most every STEP_EVERY seconds, so a
    job running elsewhere (GitHub, a Telegram button) shows some progress in the app and in Notion."""
    import time
    if not _open.get('run') or len(line) > 160 or line.startswith(('Warning', ' ', 'Cronjob run logged', JOB_LINE, '<<<', 'message>>>')):
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
            name = missing.group(1).strip().strip('"').strip("'") if missing else ''
            if name not in properties:
                raise
            properties = {k: v for k, v in properties.items() if k != name}
    return send(properties)


def log_run(tracker, run, failed=False):
    """Complete the row begin() opened (or create it); returns its URL, or None when Notion refuses (never raises)."""
    from .. import telegram
    try:
        properties, children = run_page(run, final=not failed)
        if failed:
            properties['Status'] = {'select': {'name': 'Failed'}}
        children = children[:50] + extra_blocks(telegram.MESSAGES, list(_output))
        if _open.get('id') and _open.get('run') is run:
            _open.pop('run')
            _without_missing(lambda props: tracker._request('PATCH', f"pages/{_open['id']}", {'properties': props}), properties)
            tracker._request('PATCH', f"blocks/{_open['id']}/children", {'children': children[:100]})
            url = _open.get('url')
            run_result.note_notion(url)
            run_result.publish(run, failed=failed)
            return url
        page = _without_missing(lambda props: tracker._request('POST', 'pages', {'parent': {'database_id': CRON_RUNS_DATABASE_ID},
                                                                                'properties': props, 'children': children[:100]}), properties)
        run_result.note_notion(page.get('url'))
        run_result.publish(run, failed=failed)
        return page.get('url')
    except Exception as error:
        run_result.publish(run, failed=True)
        print(f'Warning: cronjob run not logged to Notion: {type(error).__name__}: {error}')
        return None


def _on_terminate(signum, frame):
    """The desktop app's watchdog stops a stuck run with SIGTERM: leave through sys.exit so atexit runs and the row says what
    happened (SIGTERM alone kills Python at once and the row stayed "Running" for hours, 2 Oct 2026)."""
    sys.exit(128 + signum)


try:
    signal.signal(signal.SIGTERM, _on_terminate)
except ValueError:  # not the main thread (a test): nothing to install
    pass


@atexit.register
def _unfinished():
    """A job that ended before reporting (a crash, an early exit): its row says so instead of staying Running."""
    if _open.get('run'):
        run = _open['run']
        run['warnings'] = list(run.get('warnings') or []) + ['ended before its report (see the technical log)']
        log_run(_open['tracker'], run, failed=True)
