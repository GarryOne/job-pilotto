"""Writing side of the Gmail check: the events index, the stage ladder (advance, forward only), the Changes column text and record().
Guarded by tests/test_mail_stages.py and tests/test_event_dedupe.py."""
from datetime import datetime, timezone
import json
import sys

from ..notion import ledger
from ..notion.ledger import REPLY
from ..stores import rules
from . import opportunity
from .. import feedback as employer_feedback
from .mail_config import RANK, TERMINAL, TZ, YOU_REPLIED
from .mail_read import _field, _when


def _events_index(stores):
    """Known Source IDs, per job record id: [(kind, at, event id, source id)], and the ids of the events the stage
    watcher guessed (Source "Notion edit"/"Backfill"): a real item that adopts one gives it its own source."""
    known, by_app, guessed = set(), {}, set()
    for event in stores.events.list():
        if event['source_id']:
            known.add(event['source_id'])
        if event['source'] in ledger.WATCHER_SOURCES:
            guessed.add(event['id'])
        if event['app_id']:
            by_app.setdefault(event['app_id'].replace('-', ''), []).append(
                (event['kind'], event['at'] or '', event['id'], event['source_id'] or ''))
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


# The job fields one email can move, by the name a run's log and an event's Changes JSON have always used for each.
MOVED = {'stage': 'Stage', 'next_interview': 'Next interview', 'feedback_status': 'Feedback status',
         'confirmation_email': 'Confirmation email'}


def _value(row, key):
    if key == 'confirmation_email':
        return bool(row.get(key))
    return _field(row, key) or None


def advance(stores, row, kind, interview_at=None, now=None, *, by_app=None, feedback_text='', out=None):
    """Move a job forward for one email (Stage forward only, Next interview, flags). Returns {field: [before, after]},
    by the names in MOVED. `out`, when given, is filled with that mapping too: a caller that reports what ran keeps it
    without a second read. `row` (the job's record) is updated in place."""
    if not hasattr(stores, 'applications'):
        # BRIDGE(mail reassign): remove when reassign.py on the store lands
        from ..stores import open_stores
        stores = open_stores(tracker=stores)
        row = stores.applications._record(row)
    key, by_app = row['id'].replace('-', ''), by_app or {}
    changes = {}
    stage = _stage_for(kind, _field(row, 'stage'))
    # A recruiter writing back after you answered their pitch: you're talking now (Screening), as when you say yes
    # through "Log job activity" (src/ai/inbox.py).
    if kind == REPLY and _field(row, 'stage') == opportunity.LEAD_STAGE and any(k == YOU_REPLIED for k, *_ in by_app.get(key, [])):
        stage = 'Screening'
    if stage:
        changes['stage'] = stage
    if kind == 'Rejected' and not feedback_text and not _field(row, 'feedback_status'):
        history = [{'kind': k, 'at': t} for k, t, _, _ in by_app.get(key, [])]
        # Only reached with no Feedback status, so eligible() decides on the history alone (its row check is that status).
        # BRIDGE(mac-67 feedback): remove when feedback.eligible on job records lands
        if _field(row, 'stage') in employer_feedback.REACHED or employer_feedback.eligible({'properties': {}}, history):
            changes['feedback_status'] = 'Not asked'
    moment, current = _when(interview_at or ''), _when(_field(row, 'next_interview'))
    now = now or datetime.now(timezone.utc)
    if moment and moment > now and (not current or current < now or moment < current):
        changes['next_interview'] = moment.isoformat()
    if kind == 'Confirmation received':
        changes['confirmation_email'] = True
    before = {name: _value(row, name) for name in changes}
    if changes:
        stores.applications.update(row['id'], changes)
        row.update(changes)
    fields = {MOVED[name]: [before[name], _value(row, name)] for name in changes}
    if out is not None:
        out.update(fields)
    return fields


def _receive(stores, row, text):
    """The employer's own words on the job: Notion only for now; another store says it is not kept yet (the event
    still records the email)."""
    # BRIDGE(mac-67 feedback): remove when feedback.receive on the store lands
    if stores.name != 'notion':
        print('Warning: employer feedback not kept on this store yet; the email is still recorded.', file=sys.stderr)
        return
    notion_row = _notion_row(stores, row)
    employer_feedback.receive(stores.applications.tracker, notion_row, text)
    row.update(stores.applications._record(notion_row))


def _notion_row(stores, row):
    """The Notion row of a job record, read through the store's own client; a record of another store passes as it is."""
    # BRIDGE(mac-67 feedback, mac-4a rejection): remove when the move of feedback and rejection to job records lands
    tracker = getattr(stores.applications, 'tracker', None)
    if stores.name != 'notion' or tracker is None:
        return row
    return {'id': row['id'], 'url': stores.link(row['id']), **tracker._request('GET', f"pages/{row['id']}")}


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


def changes_of(fields, email=None, feedback=''):
    """An event's `changes` (src/stores/base.py): what it moved and which email it was. Its interview time is the event's own
    field; the Notion store keeps both in the one Changes JSON, as before."""
    data = {'fields': fields}
    if email:
        data['from'], data['subject'] = email.get('from', '')[:200], email.get('subject', '')[:200]
    if feedback:
        data['feedback'] = feedback[:1200]
    return data


def changes_text(fields, interview_at=None, email=None, feedback=''):
    """The event's Changes column (JSON) as a Notion property."""
    # BRIDGE(mail reassign): remove when reassign.py on the store lands
    data = changes_of(fields, email, feedback)
    if interview_at:
        data = {'fields': data.pop('fields'), 'interview_at': interview_at, **data}
    return {'rich_text': [{'text': {'content': json.dumps(data, ensure_ascii=False)[:1990]}}]}


def record(stores, row, kind, at, source, source_id, note, index, interview_at=None, now=None, feedback_text='', email=None,
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
        _receive(stores, row, feedback_text)
    if twin:
        event, existing = {'id': twin[0], 'interview_at': ''}, False
    else:
        event, existing = rules.add_event(stores, row, kind, source, at=at, note=note, source_id=source_id,
                                          interview_at=interview_at or '')
    if existing and not (interview_at and not event['interview_at']):
        known.add(source_id)  # this job already has that event (same kind, same interview): nothing new to write
        return None
    if existing:  # an interview logged without its time: this item gives it (Changes, Next interview)
        moved = advance(stores, row, kind, interview_at, now, by_app=by_app, feedback_text=feedback_text, out=fields)
        stores.events.update(event['id'], {'changes': changes_of(moved, email), 'interview_at': interview_at})
        known.add(source_id)
        return kind if moved else None
    by_app.setdefault(key, []).append((kind, at, event['id'], source_id))
    moved = advance(stores, row, kind, interview_at, now, by_app=by_app, feedback_text=feedback_text, out=fields)
    adopted = {'source_id': source_id, 'at': at}
    if twin and twin[0] in guessed:  # the watcher's guess ("Stage changed in Notion") was this item: it says so now
        adopted.update({'source': source, 'note': note[:1900]})
        guessed.discard(twin[0])
    stores.events.update(event['id'], {**adopted, 'changes': changes_of(moved, email),
                                       **({'interview_at': interview_at} if interview_at else {})})
    known.add(source_id)
    stage = (moved.get('Stage') or [None, None])[1]
    return None if twin else stage or kind
