#!/usr/bin/env python3
"""Interview analysis: a recording, a transcript file or typed notes -> 🎤 Interviews.

The Worker passes the Telegram file id (or the notes text) to a `--mode interview` run; the desktop app
passes a file on the Mac, and optionally the job it belongs to (--job <job URL>). A recording (voice note,
audio or video) is first transcribed on the machine, with speakers, by transcribe.py (open-source models,
free). This module strips subtitle timing (.srt/.vtt), and asks Claude Sonnet 5 in one call to
(1) pick which application the interview belongs to (unless the job was given), from the caption and the transcript, and
(2) pull out the questions by topic, how each was answered, strengths, weak spots, signals from the
interviewers, the next step and what to practise.

The same call (3) pulls out the facts the call revealed about the job (salary, contract, relocation, place,
team, visa, start date), each only when said and with a short quote.

The result is a 🎤 Interviews row linked to the application (analysis plus the full transcript in its
page body) and the application moved on (advance(): the call happened, so a Recruiter lead, Screening or
Interview scheduled is Interviewing now; never back, never a closed stage), with its 📈 Application Events row,
Next step from the review, a past Next interview cleared and the call's facts filled into empty fields (a
different value already there is not overwritten: the review page and the summary show both). Then a Telegram
summary. The daily insight and weekly report read the Interviews rows.
A row reviewed before can be reviewed again from the app (review_again(): the review replaced, only empty fields
of the job filled, no Stage change or event). A recording saved without a review moves the application on the same way (save(), link()); an interview
that wasn't recorded is confirmed from Focus ("Did it happen?": held(), moved(), cancelled()).
Each user's Notion is their own private database; the transcript stays there and in Telegram.
"""
from datetime import datetime, timezone
from html import escape
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import urllib.request

from . import cost
from . import engine
from . import meanings
from . import transcribe
from .. import tgcard
from ..notion import client as notion
from ..notion import titles
from ..notion.ledger import EVENTS_DATABASE_ID
from ..notion.ledger import add_event
from ..notion.ledger import plain
from ..notion.titles import named
from ..telegram import api_base as telegram_api_base
from .interviews_ai import (
    DEFAULT_MODEL, FACTS, FALLBACK_MODEL, MAX_CHARS,
    MAX_TOKENS, NOT_STATED, SCHEMA, SELECT_OPTIONS,
    SYSTEM, TEXT_TYPES, analyse, ask,
    candidates)
from .interviews_blocks import (
    NO_JOB, _block, _line_key, analysis_blocks,
    changes_lines, changes_summary, ensure_job_line, interview_title,
    job_line, message, page_blocks, properties,
    transcript_toggle)
from .interviews_facts import _call_facts, _norm, fact_lines, facts_of, merge_facts  # noqa: F401
from .interviews_input import clean, download, read_input  # noqa: F401
from .interviews_review import (
    PLACEHOLDER, REVIEW_HEADINGS, _plain_block, add_review,
    replace_review, review_block_ids)
from .interviews_stages import (
    APP_SOURCE, BEFORE_INTERVIEW, CANCELLED, CANDIDATE_STAGES,
    CLOSED, IN_TALKS, held_stage)
from .interviews_store import _place, application_for, by_url, delete, saved_transcript  # noqa: F401


INTERVIEWS_DATABASE_ID = os.getenv('NOTION_INTERVIEWS_DB', '')


def _moment(value):
    try:
        moment = datetime.fromisoformat((value or '').replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _events_of(tracker, app):
    page = app['id'].replace('-', '')
    return [e for e in tracker.query_database(EVENTS_DATABASE_ID)
            if any(l['id'].replace('-', '') == page for l in (e['properties'].get('Application') or {}).get('relation', []))]


def advance(tracker, app, *, now=None, round_='', next_step='', changes=None, note='', source='Telegram', clear_past=True):
    """An interview of this application was held: Stage forward (held_stage), a 📈 Application Events row of that
    kind unless one exists (a review is often sent days after the call, which was usually logged already), Next
    step from the review, a past Next interview cleared (clear_past), plus `changes` (the call's facts), in one
    Notion update. An application at a closed stage (Offer, Rejected, …) is left alone. Returns the new Stage or None."""
    now = now or datetime.now(timezone.utc)
    stage = plain(app['properties'].get('Stage')) or ''
    if stage in CLOSED:
        return None
    target = held_stage(stage, round_)
    kind = target or ('Screening' if meanings.round_kind(round_) == 'recruiter_screen' else 'Interviewing')  # what was held
    if not any(plain(e['properties'].get('Kind')) == kind for e in _events_of(tracker, app)):
        add_event(tracker, app, kind, source, note=note)
    update = dict(changes or {})
    if target:
        update['Stage'] = {'select': {'name': target}}
    if next_step and not NOT_STATED.match(next_step):
        update['Next step'] = {'rich_text': [{'text': {'content': next_step[:2000]}}]}
    coming = _moment(plain(app['properties'].get('Next interview')))
    if clear_past and coming and coming <= now:
        update['Next interview'] = {'date': None}
    if update:
        tracker.update_page(app['id'], update)
    return target


def run(tracker, *, file_id=None, note='', token=None, send=None, model=DEFAULT_MODEL, client=None,
        now=None, opener=urllib.request.urlopen, stats=None, job_url=None, page_id=None, found=None):
    """Analyse one interview (a recording, a transcript file, or notes text) and record it. Returns a log
    line ending with the 🎤 Interviews page URL. job_url links it to that application instead of guessing.
    page_id reviews a row saved earlier (save()): its transcript is read from Notion, the review is added
    to that page and its Application is kept unless job_url changes it. A row already reviewed is reviewed again
    (review_again). found (a dict) gets the reviewed job's Applications row id as 'application', once known."""
    now = now or datetime.now(timezone.utc)
    caption, transcript, recorded = note, '', False
    saved = tracker._request('GET', f'pages/{page_id}') if page_id else None
    # A row that already has a review (Overall set) is reviewed again: see review_again() below.
    again = bool(saved and plain(saved['properties'].get('Overall')))
    if saved:
        transcript = saved_transcript(tracker, page_id)
        caption = note or plain(saved['properties'].get('Interview'))
        recorded = plain(saved['properties'].get('Input')) == 'Recording'
        linked = [r['id'] for r in (saved['properties'].get('Application') or {}).get('relation', [])]
    elif file_id:
        _, transcript, recorded = read_input(file_id, token, opener)
    else:
        # "/interview <caption line>\n<notes>" — the first line names the interview, the rest is notes.
        body = re.sub(r'^/interview(@\w+)?\s*', '', note or '')
        caption, _, transcript = body.partition('\n')
        transcript = transcript.strip() or caption
    if len(transcript.strip()) < 40:
        raise ValueError('Too little text to analyse. Send the recording or transcript file, or /interview <company, round> '
                         'with your notes on the next lines.')
    truncated = len(transcript) > MAX_CHARS
    transcript = transcript[:MAX_CHARS]
    apps = candidates(tracker)
    chosen = (by_url(tracker, apps, job_url) or application_for(tracker, job_url)) if job_url else None
    if saved and not chosen and linked:
        chosen = next((row for row in apps if row['id'] == linked[0]), None) or tracker._request('GET', f'pages/{linked[0]}')
    if chosen and chosen not in apps:
        apps = [chosen] + apps
    if client is None:
        client = engine.client(action='interview')
    result, usage, model = analyse(client, model, tracker.page_text(), apps, caption, transcript)
    cost.add(stats, model, usage)
    usd = cost.usd(model, usage)
    app = chosen or (apps[result['application']] if 0 <= result['application'] < len(apps) else None)
    if again:  # a review again: the row keeps its job; no guess links it elsewhere
        app = chosen
    if app and found is not None:
        found['application'] = app['id']
    if found is not None:  # the interview's title, for the run's ("Huxley · Recruiter screen"); a review again keeps its own
        found['title'] = (plain(saved['properties'].get('Interview')) if again else '') or \
            interview_title(result['company'], result['round'], app)
    source = (plain(saved['properties'].get('Input')) or 'Transcript') if saved else (
        'Recording' if recorded else 'Transcript' if file_id else 'Notes')
    props = properties(result, app, now.date(), cost.answered(model, usage), usd, source)
    # An application at a closed stage is never touched: its facts are only listed on the review.
    merged = merge_facts(app, result) if app and plain(app['properties'].get('Stage')) not in CLOSED else None
    if again:
        return review_again(tracker, page_id, saved, result, app, merged, props, usd, send, truncated)
    if saved:
        props.pop('Date')  # the day it was held, set when it was saved
        page = tracker._request('PATCH', f'pages/{page_id}', {'properties': props})
        add_review(tracker, page_id, analysis_blocks(result, merged))
        ensure_job_line(tracker, page_id, app)
    else:
        page = tracker._request('POST', 'pages', {'parent': {'database_id': INTERVIEWS_DATABASE_ID},
                                                  'properties': props,
                                                  'children': [job_line(app)] + page_blocks(result, transcript, merged)})
    stage = None
    if app:
        stage = advance(tracker, app, now=now, round_=result['round'], next_step=result['next_step'],
                        changes=(merged or {}).get('changes'), note=f"{result['round']}: {result['overall']}")
    if send:
        send(message(result, app, page.get('url', ''), usd, truncated, merged, stage))
    where = f"{plain(app['properties'].get('Company')) or plain(app['properties'].get('Via')) or 'linked'}" if app else 'unlinked'
    extra = changes_summary(merged, stage)
    return (f"Interview analysed ({where}, {result['round']}, {len(result['questions'])} questions, ${usd:.3f})"
            f"{f'. {extra[0].upper()}{extra[1:]}' if extra else ''} {page.get('url', '')}").strip()


def review_again(tracker, page_id, saved, result, app, merged, props, usd, send=None, truncated=False):
    """The Interviews page's "Review again" (a row reviewed before, e.g. before facts were extracted): the review
    sections are replaced (replace_review), the row keeps its title, date, input and job link, its Cost adds this
    call's, and the job gets only what it lacks: the call's facts in EMPTY fields (merge_facts) and Next step when
    it's empty. No Stage change, no event, no Next interview cleared: the call was held and counted at the first
    review. Running it twice changes nothing on the job the second time."""
    for kept in ('Date', 'Interview', 'Input', 'Application'):
        props.pop(kept, None)
    before = (saved['properties'].get('Cost (USD)') or {}).get('number') or 0
    props['Cost (USD)'] = {'number': round(before + usd, 4)}
    replace_review(tracker, page_id, analysis_blocks(result, merged))  # first: a failure leaves the old review whole
    page = tracker._request('PATCH', f'pages/{page_id}', {'properties': props})
    ensure_job_line(tracker, page_id, app)
    update = {}
    if app and merged is not None:
        update = dict(merged.get('changes') or {})
        step = result.get('next_step') or ''
        if step and not NOT_STATED.match(step) and not plain(app['properties'].get('Next step')):
            update['Next step'] = {'rich_text': [{'text': {'content': step[:2000]}}]}
        if update:
            tracker.update_page(app['id'], update)
    if send:
        send(message(result, app, page.get('url', '') or saved.get('url', ''), usd, truncated, merged))
    where = f"{plain(app['properties'].get('Company')) or plain(app['properties'].get('Via')) or 'linked'}" if app else 'unlinked'
    extra = '; '.join(filter(None, ('' if (merged or {}).get('filled') or 'Next step' in update else 'nothing new for the job',
                                    changes_summary(merged), 'Next step set' if 'Next step' in update else '')))
    return (f"Interview analysed again ({where}, {result['round']}, {len(result['questions'])} questions, ${usd:.3f})"
            f". {extra[0].upper()}{extra[1:]} {page.get('url', '') or saved.get('url', '')}").strip()


def save(tracker, transcript, title, *, job_url=None, source='Recording', now=None, page_id=None):
    """A transcript as a 🎤 Interviews row, without AI: title, date, Input, the chosen job, and the
    transcript in the page (a placeholder marks where the review goes). Returns the created page.
    With page_id (the row the app created as soon as the transcript was ready), that row is updated instead:
    title, job, and the transcript toggle replaced by the edited one (speakers named).
    A recorded call was held: the chosen job moves on (advance), keeping a past Next interview until the review,
    so Focus asks to review it."""
    now = now or datetime.now(timezone.utc)
    transcript = transcript.strip()[:MAX_CHARS]
    if len(transcript) < 40:
        raise ValueError('Too little text to save')
    props = {'Interview': {'title': [{'text': {'content': (title or 'Interview')[:200]}}]},
             'Date': {'date': {'start': now.date().isoformat()}}, 'Input': {'select': {'name': source}}}
    app = application_for(tracker, job_url) if job_url else None
    if app:
        props['Application'] = {'relation': [{'id': app['id']}]}
    if page_id:
        props.pop('Date')  # the day it was first saved stays
        if not app:
            props['Application'] = {'relation': []}
        page = tracker._request('PATCH', f'pages/{page_id}', {'properties': props})
        for block in tracker._children(page_id):
            body = block.get(block['type'], {})
            if block['type'] == 'heading_3' and plain({'type': 'rich_text', 'rich_text': body.get('rich_text', [])}) == 'Transcript':
                tracker._request('DELETE', f"blocks/{block['id']}")
        tracker._request('PATCH', f'blocks/{page_id}/children', {'children': [transcript_toggle(transcript)]})
        ensure_job_line(tracker, page_id, app)
    else:
        page = tracker._request('POST', 'pages', {'parent': {'database_id': INTERVIEWS_DATABASE_ID}, 'properties': props,
                                                  'children': [job_line(app), _block('paragraph', PLACEHOLDER), transcript_toggle(transcript)]})
    if app:
        advance(tracker, app, now=now, round_=title, note=f'{source} saved', source=APP_SOURCE, clear_past=False)
    return page


def link(tracker, page_id, job_url=None):
    """Set (or with no job_url, clear) the application a 🎤 Interviews row belongs to."""
    app = application_for(tracker, job_url) if job_url else None
    tracker.update_page(page_id, {'Application': {'relation': [{'id': app['id']}] if app else []}})
    ensure_job_line(tracker, page_id, app)
    if app:  # a recorded call belongs to this job: it was held
        advance(tracker, app, note='Interview linked', source=APP_SOURCE, clear_past=False)
    return app['id'] if app else None


def listing(tracker, limit=100, places=True):
    """🎤 Interviews rows for the app, newest first: reviewed when Overall is set. `place` is where the linked
    application's job is (Location, Work mode from Applications; one Notion read per linked job, so places=False skips them:
    the Calendar does not show a place and waited ~20 s for them)."""
    rows = []
    for row in tracker.query_database(INTERVIEWS_DATABASE_ID):
        props = row['properties']
        rows.append({'id': row['id'], 'url': row.get('url', ''), 'title': plain(props.get('Interview')) or 'Interview',
                     'date': plain(props.get('Date')) or row.get('created_time', '')[:10],
                     'input': plain(props.get('Input')) or '', 'overall': plain(props.get('Overall')) or '',
                     'round': plain(props.get('Round')) or '', 'next_step': plain(props.get('Next step')) or '',
                     'application': [r['id'] for r in (props.get('Application') or {}).get('relation', [])]})
    rows.sort(key=lambda r: r['date'], reverse=True)
    rows, seen = rows[:limit], {}
    for row in rows:
        row['place'] = _place(tracker, row['application'][0], seen) if places and row['application'] else {}
    return rows


NO_NOTES = 'No notes written. The interview was held (confirmed in Focus).'


def held(tracker, app_id, notes='', *, now=None):
    """Focus → "Yes, it happened": a 🎤 Interviews row (Input Notes, dated the day of the interview) with the notes
    where a transcript goes, and the application moved on. review: the notes are long enough for a review (the
    app then runs it, on this Mac or on GitHub)."""
    now = now or datetime.now(timezone.utc)
    app = tracker._request('GET', f'pages/{app_id}')
    props = app['properties']
    coming = _moment(plain(props.get('Next interview')))
    day = (coming if coming and coming <= now else now).date().isoformat()
    who = plain(props.get('Company')) or plain(props.get('Via')) or 'Interview'
    notes = (notes or '').strip()[:MAX_CHARS]
    page = tracker._request('POST', 'pages', {'parent': {'database_id': INTERVIEWS_DATABASE_ID}, 'properties': {
        'Interview': {'title': [{'text': {'content': f"{who} · {titles.row_role(props) or 'interview'}"[:200]}}]},
        'Date': {'date': {'start': day}}, 'Input': {'select': {'name': 'Notes'}},
        'Application': {'relation': [{'id': app['id']}]}},
        'children': [job_line(app), _block('paragraph', PLACEHOLDER), transcript_toggle(notes or NO_NOTES)]})
    stage = advance(tracker, app, now=now, note='Held (confirmed in Focus)', source=APP_SOURCE)
    return {'ok': True, 'id': page['id'], 'url': page.get('url', ''), 'stage': stage, 'review': len(notes) >= 40}


def moved(tracker, app_id, at):
    """Focus → "No: moved": Next interview is the new time, and an Interview scheduled event says so."""
    moment = _moment(at)
    if not moment:
        raise ValueError('Pick the new date and time')
    app = tracker._request('GET', f'pages/{app_id}')
    tracker.update_page(app['id'], {'Next interview': {'date': {'start': at}}})
    add_event(tracker, app, 'Interview scheduled', APP_SOURCE, note=f'Moved to {at} (from Focus)', interview_at=at)
    return {'ok': True}


def cancelled(tracker, app_id):
    """Focus → "No: cancelled": an Interview cancelled event, Next interview cleared; the Stage stays."""
    app = tracker._request('GET', f'pages/{app_id}')
    add_event(tracker, app, CANCELLED, APP_SOURCE, note='The interview did not happen (from Focus)')
    tracker.update_page(app['id'], {'Next interview': {'date': None}})
    return {'ok': True}


def sweep(tracker, now=None):
    """Applications still at Recruiter lead / Screening / Interview scheduled whose Next interview has passed and
    which have a 🎤 Interviews row from that day on (recorded): moved on (advance), as a review would.
    For rows saved before save() did it. Returns a one-line summary."""
    now = now or datetime.now(timezone.utc)
    if not INTERVIEWS_DATABASE_ID:
        return 'Interview sweep: no 🎤 Interviews database'
    days = {}
    for row in tracker.query_database(INTERVIEWS_DATABASE_ID):
        day = (plain(row['properties'].get('Date')) or '')[:10]
        for link in (row['properties'].get('Application') or {}).get('relation', []):
            key = link['id'].replace('-', '')
            days[key] = max(days.get(key, ''), day)
    moved_on = 0
    for app in tracker.query_database(tracker.database_id, {'or': [
            {'property': 'Stage', 'select': {'equals': stage}} for stage in IN_TALKS]}):
        coming = _moment(plain(app['properties'].get('Next interview')))
        if coming and coming <= now and days.get(app['id'].replace('-', ''), '') >= coming.date().isoformat():
            advance(tracker, app, now=now, note='Recorded interview', source='Auto rule', clear_past=False)
            moved_on += 1
    return f'Interview sweep: {moved_on} application(s) moved on after a recorded interview.'


def main(argv=None):
    """JSON commands for the desktop app's Interviews page (Notion is the database; nothing here uses AI)."""
    import argparse
    parser = argparse.ArgumentParser(description=main.__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list')
    sub.add_parser('calendar', help='the rows only: no places, no insight (the Calendar)')
    saving = sub.add_parser('save', help='a transcript file as a new row')
    saving.add_argument('file', type=Path)
    saving.add_argument('--title', default='')
    saving.add_argument('--job', help='job URL of the application it belongs to')
    saving.add_argument('--input', default='Recording', choices=('Recording', 'Transcript', 'Notes'))
    saving.add_argument('--page', help='update this row (created when the transcript was ready) instead of adding one')
    deleting = sub.add_parser('delete', help="move a row to Notion's trash")
    deleting.add_argument('page')
    linking = sub.add_parser('link', help="set a row's application (no --job: clear it)")
    linking.add_argument('page')
    linking.add_argument('--job')
    holding = sub.add_parser('held', help='Focus: the interview happened (notes optional)')
    holding.add_argument('app')
    holding.add_argument('--notes', default='')
    moving = sub.add_parser('moved', help='Focus: the interview moved to a new time')
    moving.add_argument('app')
    moving.add_argument('--at', required=True)
    cancelling = sub.add_parser('cancelled', help='Focus: the interview did not happen')
    cancelling.add_argument('app')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker or not INTERVIEWS_DATABASE_ID:
        print(json.dumps({'ok': False, 'error': 'Connect Notion first: interviews are kept in 🎤 Interviews.'}))
        return 1
    try:
        if args.command == 'list':
            problems = []
            out = {'ok': True, 'interviews': listing(tracker), 'insight': saved_insight(tracker, problems)}
            if problems:
                out['insight_error'] = problems[0]  # the app logs it and says so on the card; the list still shows
        elif args.command == 'calendar':
            out = {'ok': True, 'interviews': listing(tracker, places=False)}
        elif args.command == 'save':
            page = save(tracker, args.file.read_text(encoding='utf-8'), args.title, job_url=args.job, source=args.input,
                        page_id=args.page)
            out = {'ok': True, 'id': page['id'], 'url': page.get('url', '')}
        elif args.command == 'delete':
            delete(tracker, args.page)
            out = {'ok': True}
        elif args.command == 'held':
            out = held(tracker, args.app, args.notes)
        elif args.command == 'moved':
            out = moved(tracker, args.app, args.at)
        elif args.command == 'cancelled':
            out = cancelled(tracker, args.app)
        else:
            out = {'ok': True, 'application': link(tracker, args.page, args.job)}
    except ValueError as error:
        out = {'ok': False, 'error': str(error)}
    print(json.dumps(out))
    return 0 if out['ok'] else 1


def saved_insight(tracker, problems=None):
    """The Interviews page's insight (💡 Insights, Interview patterns), or None; a failed read never fails the list.
    problems: gets the reason (error type and message, no values), for the app's log and the card."""
    from . import interview_insights
    try:
        return interview_insights.saved(tracker)
    except Exception as error:  # noqa: BLE001
        reason = f'{type(error).__name__}: {error}'
        print(f'Warning: interview insights unreadable: {reason}', file=sys.stderr)
        if problems is not None:
            problems.append(reason)
        return None


def stats_for_insights(tracker):
    """Interview topics across all interviews, for the daily insight and weekly report."""
    rows = [{name: plain(prop) for name, prop in r['properties'].items()}
            for r in tracker.query_database(INTERVIEWS_DATABASE_ID)]
    rows = [r for r in rows if r.get('Overall')]  # saved transcripts not reviewed yet have no analysis
    split = lambda value: [t.strip() for t in (value or '').split(';') if t.strip()]
    topics, weak = {}, {}
    for row in rows:
        for t in split(row.get('Topics')):
            topics[t] = topics.get(t, 0) + 1
        for t in split(row.get('Weak topics')):
            weak[t] = weak.get(t, 0) + 1
    top = lambda d: dict(sorted(d.items(), key=lambda kv: -kv[1])[:15])
    return {'interviews': len(rows), 'overall': {k: sum(r.get('Overall') == k for r in rows)
                                                for k in ('positive', 'neutral', 'negative')},
            'topics_asked': top(topics), 'topics_answered_weakly': top(weak),
            'rounds': [f"{r.get('Date')} · {r.get('Interview')} · {r.get('Overall')}" for r in rows][-10:]}


if __name__ == '__main__':
    raise SystemExit(main())
