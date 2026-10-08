"""Writing side of the Gmail check: the events index, the stage ladder (advance, forward only), the Changes column text and record().
Guarded by tests/test_mail_stages.py and tests/test_event_dedupe.py."""
from datetime import datetime, timezone
import json
import sys
import urllib.error

from ..notion import ledger
from ..notion.ledger import EVENTS_DATABASE_ID, REPLY, add_event, plain
from . import opportunity
from .. import feedback as employer_feedback
from .mail_config import RANK, TERMINAL, TZ, YOU_REPLIED
from .mail_read import _field, _when


def _events_index(tracker):
    """Known Source IDs, per application page id: [(kind, at, event page id, source id)], and the ids of the events
    the stage watcher guessed (Source "Notion edit"/"Backfill"): a real item that adopts one gives it its own source."""
    known, by_app, guessed = set(), {}, set()
    for event in tracker.query_database(EVENTS_DATABASE_ID):
        props = event['properties']
        source_id = plain(props.get('Source ID')) or ''
        if source_id:
            known.add(source_id)
        if plain(props.get('Source')) in ledger.WATCHER_SOURCES:
            guessed.add(event['id'])
        for link in (props.get('Application') or {}).get('relation', []):
            by_app.setdefault(link['id'].replace('-', ''), []).append(
                (plain(props.get('Kind')), plain(props.get('At')) or '', event['id'], source_id))
    return known, by_app, guessed


def _near(existing, kind, at, hours=24):
    """An event of this kind within `hours` of `at` (and without a source id yet), or None."""
    moment = _when(at)
    for event_kind, event_at, event_id, source_id in existing:
        other = _when(event_at if 'T' in event_at else event_at + 'T12:00:00')
        if event_kind == kind and not source_id and moment and other and abs((moment - other).total_seconds()) < hours * 3600:
            return event_id, source_id
    return None


def _stage_for(kind, current):
    target = {'Confirmation received': 'Confirmation received', 'Interview scheduled': 'Interview scheduled',
              'Rejected': 'Rejected', 'Offer': 'Offer'}.get(kind)
    if not target or current in TERMINAL:
        return None
    if target in TERMINAL:
        return target
    return target if RANK.get(target, 0) > RANK.get(current, 0) else None


def _value(row, name):
    prop = row['properties'].get(name) or {}
    if 'checkbox' in prop:
        return bool(prop['checkbox'])
    return _field(row, name) or None


def advance(tracker, row, kind, interview_at=None, now=None, *, by_app=None, feedback_text='', out=None):
    """Move a job forward for one email (Stage forward only, Next interview, flags). Returns {field: [before, after]}.
    `out`, when given, is filled with that mapping too: a caller that reports what ran keeps it without a second read."""
    key, by_app = row['id'].replace('-', ''), by_app or {}
    changes = {}
    stage = _stage_for(kind, _field(row, 'Stage'))
    # A recruiter writing back after you answered their pitch: you're talking now (Screening), as when you say yes
    # through "Log job activity" (src/ai/inbox.py).
    if kind == REPLY and _field(row, 'Stage') == opportunity.LEAD_STAGE and any(k == YOU_REPLIED for k, *_ in by_app.get(key, [])):
        stage = 'Screening'
    if stage:
        changes['Stage'] = {'select': {'name': stage}}
    if kind == 'Rejected' and not feedback_text and not _field(row, 'Feedback status'):
        history = [{'kind': k, 'at': t} for k, t, _, _ in by_app.get(key, [])]
        if _field(row, 'Stage') in employer_feedback.REACHED or employer_feedback.eligible(row, history):
            changes['Feedback status'] = {'select': {'name': 'Not asked'}}
    moment, current = _when(interview_at or ''), _when(_field(row, 'Next interview'))
    now = now or datetime.now(timezone.utc)
    if moment and moment > now and (not current or current < now or moment < current):
        changes['Next interview'] = {'date': {'start': moment.isoformat()}}
    if kind == 'Confirmation received':
        changes['Confirmation email'] = {'checkbox': True}
    before = {name: _value(row, name) for name in changes}
    if changes:
        tracker.update_page(row['id'], changes)
        row['properties'].update(changes)
    fields = {name: [before[name], _value(row, name)] for name in changes}
    if out is not None:
        out.update(fields)
    return fields


# The fields one email can move on a job (advance() writes exactly these): named in a run's log as before -> after.
MOVED_FIELDS = ('Stage', 'Next interview', 'Feedback status', 'Confirmation email')


def changes_readable(fields):
    """The fields one email moved, in words for a run's page: "Stage Applied → Confirmation received; Confirmation
    email set". Only the fields an email can move, so nothing internal leaks into the log."""
    parts = []
    for name, (was, now) in (fields or {}).items():
        if name not in MOVED_FIELDS or was == now:
            continue
        if name == 'Confirmation email':
            parts.append('Confirmation email set' if now else 'Confirmation email cleared')
        elif name == 'Next interview':
            parts.append(f"Next interview {_moment(was)} → {_moment(now)}")
        else:
            parts.append(f"{name} {_plain(was) if was else 'empty'} → {_plain(now)}")
    return '; '.join(parts)


def _plain(value):
    """A run's page shows a select value's own name ({"select": {"name": "Applied"}} -> "Applied"), not its JSON."""
    if isinstance(value, dict):
        return str((value.get('select') or {}).get('name') or value.get('url') or 'empty')
    return str(value)


def _moment(value):
    """A date field's value in words ("Thu 01 Oct 12:30"), or the raw value when it isn't a date."""
    when = _when(str(value or ''))
    return f"{when.astimezone(TZ):%a %d %b %H:%M}" if when else str(value or 'empty')


def gmail_link(message_id):
    """Where one email can be opened again (the same link the app uses for a message it tracked)."""
    return f'https://mail.google.com/mail/u/0/#all/{message_id}' if message_id else ''


def changes_text(fields, interview_at=None, email=None, feedback=''):
    """The event's Changes column (JSON): what it changed, when the interview is, and which email it was."""
    data = {'fields': fields}
    if interview_at:
        data['interview_at'] = interview_at
    if email:
        data['from'], data['subject'] = email.get('from', '')[:200], email.get('subject', '')[:200]
    if feedback:
        data['feedback'] = feedback[:1200]
    return {'rich_text': [{'text': {'content': json.dumps(data, ensure_ascii=False)[:1990]}}]}


def record(tracker, row, kind, at, source, source_id, note, index, interview_at=None, now=None, feedback_text='', email=None,
           fields=None):
    """Write one matched item: event (or link to a hand-logged twin), Stage forward, Next interview.
    Returns a short description of what changed, or None when it was already known. `fields`, when given, collects what
    the run changed on the job ({field: [before, after]}), for the run's page — callers that report keep it."""
    key = row['id'].replace('-', '')
    known, by_app = index[:2]
    guessed = index[2] if len(index) > 2 else set()
    if source_id in known:
        return None
    interview_at = ledger.plausible_interview(interview_at, at) or None  # never a misread year (26 Sep 2024 in 2026)
    if feedback_text and kind != 'Rejected':
        kind = employer_feedback.RECEIVED
    if kind == employer_feedback.RECEIVED and not feedback_text.strip():
        return None  # no model guesses stored as employer evidence
    twin = _near(by_app.get(key, []), kind, at) if kind != employer_feedback.RECEIVED else None
    if twin and twin[1]:
        return None
    if feedback_text:
        employer_feedback.receive(tracker, row, feedback_text)
    event = {'id': twin[0]} if twin else add_event(tracker, row, kind, source, at=at, note=note,
                                                    source_id=source_id, interview_at=interview_at or '')
    if event.get('_existing') and not (interview_at and not ledger.event_interview_at(event)):
        known.add(source_id)  # this job already has that event (same kind, same interview): nothing new to write
        return None
    if event.get('_existing'):  # an interview logged without its time: this item gives it (Changes, Next interview)
        moved = advance(tracker, row, kind, interview_at, now, by_app=by_app, feedback_text=feedback_text, out=fields)
        _optional(tracker.update_page, event['id'], {'Changes': changes_text(moved, interview_at, email)})
        known.add(source_id)
        return kind if moved else None
    by_app.setdefault(key, []).append((kind, at, event['id'], source_id))
    moved = advance(tracker, row, kind, interview_at, now, by_app=by_app, feedback_text=feedback_text, out=fields)
    adopted = {'Source ID': {'rich_text': [{'text': {'content': source_id}}]}, 'At': {'date': {'start': at}}}
    if twin and twin[0] in guessed:  # the watcher's guess ("Stage changed in Notion") was this item: it says so now
        adopted.update({'Source': {'select': {'name': source}}, 'Note': {'rich_text': [{'text': {'content': note[:1900]}}]}})
        guessed.discard(twin[0])
    tracker.update_page(event['id'], adopted)
    _optional(tracker.update_page, event['id'], {'Changes': changes_text(moved, interview_at, email)})
    known.add(source_id)
    stage = (moved.get('Stage') or [None, None])[1]
    return None if twin else stage or kind


NEW_COLUMNS = ('Changes', 'Needs you', 'Suggested job')  # added 29 Sep 2026; the app adds them to older workspaces


def _optional(write, *args):
    """A write to a column a workspace may not have yet (NEW_COLUMNS): never fails the check."""
    try:
        write(*args)
    except urllib.error.HTTPError as error:
        print(f'Warning: not saved ({error.code}): the workspace may miss a new column; the app adds it.', file=sys.stderr)
