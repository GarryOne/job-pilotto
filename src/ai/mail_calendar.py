"""The Calendar pass: events that belong to an application, interview reminders and the prep message.
Guarded by tests/test_mail_calendar.py."""
import sys
from datetime import datetime, timedelta, timezone
from html import escape

from .. import tgcard
from . import cost, meanings
from .insights_data import interview_stats
from .mail_config import TZ
from .mail_lines import _head, _short, _who
from .mail_match import _event_text, _matches
from .mail_read import _field, _when, classify
from .mail_record import record


def calendar_pass(stores, google, client, model, apps, index, state, stats, now=None, dry_run=False):
    """Match calendar events to applications; returns (lines, reminders) for Telegram."""
    now = now or datetime.now(timezone.utc)
    events = [e for e in google.events(now - timedelta(days=1), now + timedelta(days=21))
              if e.get('status') != 'cancelled' and (e.get('start') or {}).get('dateTime')]
    matched, maybe = [], []
    for event in events:
        rows = [r for r in apps if _matches(r, _event_text(event))]
        if len(rows) == 1:
            matched.append((event, rows[0]))
        else:
            maybe.append(event)
    unmatched = meanings.job_events(maybe, _event_text)   # interviews in any language (AI), the English rule first for free
    if unmatched:
        items = [{'from': (e.get('organizer') or {}).get('email', ''), 'subject': e.get('summary', ''),
                  'date': e['start']['dateTime'], 'body': _event_text(e)} for e in unmatched]
        try:
            unmatched_results = classify(client, model, apps, items, stats)
        except Exception as error:  # noqa: BLE001 — the spend limit: those events are read again next check
            if not cost.limit_reached(error):
                raise
            unmatched_results = {}
        for i, result in unmatched_results.items():
            if result['relevant'] and 0 <= result['application'] < len(apps):
                matched.append((unmatched[i], apps[result['application']]))
    lines, notes = [], []
    for event, row in matched:
        start, end = _when(event['start']['dateTime']), _when(event['end']['dateTime'])
        if dry_run:
            print(f"{start:%Y-%m-%d %H:%M} {event.get('summary', '')!r} -> {_field(row, 'company')}")
            continue
        if start > now:
            changed = record(stores, row, 'Interview scheduled', event.get('created') or now.isoformat(), 'Calendar',
                             f"cal:{event['id']}", f"Calendar: {event.get('summary', '')[:150]} at {start.astimezone(TZ):%a %d %b %H:%M}",
                             index, start.isoformat(), now)
            if changed:
                lines.append(tgcard.block(_head(row, 'Interview'), f"{start.astimezone(TZ):%a %d %b · %H:%M}",
                                          tgcard.fact('Event', event.get('summary', '')[:80]), tgcard.fact('Source', 'Google Calendar')))
                _short(stats, 'Interview scheduled', row, f" · {start.astimezone(TZ):%a %d %b %H:%M}")
        notes += reminders(stores, row, event, start, end, state, now)
    return lines, notes


def reminders(stores, row, event, start, end, state, now):
    """Prep message the evening before / the morning of, and a nudge for the transcript after."""
    local, messages = now.astimezone(TZ), []
    key_before, key_after = f"prep:{event['id']}", f"after:{event['id']}"
    tomorrow = start.astimezone(TZ).date() == (local + timedelta(days=1)).date() and local.hour >= 17
    today = start.astimezone(TZ).date() == local.date() and start > now
    if (tomorrow or today) and key_before not in state['notified']:
        state['notified'].append(key_before)
        messages.append(prep_message(stores, row, event, start, 'Tomorrow' if tomorrow else 'Today'))
    if end < now < end + timedelta(hours=18) and 8 <= local.hour <= 22 and key_after not in state['notified']:
        state['notified'].append(key_after)
        # Already reviewed (a recording or notes saved from the app, Telegram or /interview on or after the call's day): don't ask.
        if not reviewed_since(stores, row, start.astimezone(TZ).date().isoformat()):
            messages.append(tgcard.card('How did it go?', '', [tgcard.block(_head(row, 'Interview'),
                tgcard.fact('Next step', 'send the transcript (or /interview with your notes) for a review'),
                tgcard.fact('Caption', f"{_who(row)}, {event.get('summary', 'interview')[:40]}"))], emoji='🎤'))
    return messages


def reviewed_since(stores, row, day):
    """True when an interview of this job is dated `day` (YYYY-MM-DD) or later: the review the nudge asks for exists
    (2 Oct 2026: a recorded review was saved and Telegram asked "How did it go?" an hour later anyway)."""
    from . import interviews  # local import: interviews imports the ledger too
    if stores.name == 'notion' and not interviews.INTERVIEWS_DATABASE_ID:
        return False  # a workspace without 🎤 Interviews
    try:
        return any((review['at'] or '')[:10] >= day for review in stores.interviews.list(app_id=row['id']))
    except Exception as error:  # noqa: BLE001 — the nudge is extra: asked once more rather than failing the check
        print(f'Warning: interviews not read: {type(error).__name__}: {error}', file=sys.stderr)
        return False


def prep_message(stores, row, event, start, day):
    people = [a.get('displayName') or a.get('email', '') for a in event.get('attendees', []) if not a.get('self')]
    weak = list(interview_stats(stores)['topics_answered_weakly'])[:3]
    link = event.get('hangoutLink') or event.get('location') or ''
    blocks = [tgcard.block(_head(row, 'Interview'), escape(f"{day} · {start.astimezone(TZ):%H:%M}"), escape(event.get('summary', '')),
                           escape(link), tgcard.fact('With', ', '.join(people[:5])))]
    if weak:
        blocks.append(tgcard.block('Answered weakly in past interviews', *[f'• {escape(t)}' for t in weak]))
    if _field(row, 'next_step'):
        blocks.append(tgcard.block('Next step', escape(_field(row, 'next_step'))[:300]))
    page = stores.link(row['id'])  # a store without pages (this Mac) has no link to give
    blocks.append('Recording? Ask everyone for consent at the start.'
                  + (f"\n<a href=\"{escape(page, quote=True)}\">Application in Notion</a>" if page else ''))
    return tgcard.card('Interview ' + day.lower(), '', blocks, emoji='🗓')
