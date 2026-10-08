#!/usr/bin/env python3
"""Pure helpers for the ledger's event rows: event times as comparable datetimes, impossible interview times,
same-occurrence window, the interview time and link ids an event carries. Re-exported by src/notion/ledger.py.

Guarded by tests/test_ledger.py and tests/test_interviews.py."""
import json
import sys
from datetime import datetime, timezone

from .. import tz
from .ledger_blocks import plain


# The stage watcher's guesses (ledger.sync): a real item (an email, an invite) that matches one adopts it and gives it
# its own Source and note (src/ai/mail.py record).
WATCHER_SOURCES = ('Notion edit', 'Backfill')

# An interview time read from a message can be impossible: "Sep 26" in a chat pasted on 21 Sep 2026 once became
# 26 Sep 2024. Nobody logs a call weeks gone as newly scheduled, nor one over a year ahead: such a time is never stored
# (the event is written without it; the app's log asks "When is the call?").
PAST_INTERVIEW_DAYS = 30
FUTURE_INTERVIEW_DAYS = 365


def plausible_interview(interview_at, said_at=None):
    """interview_at when it can be right for a message sent or logged at said_at (default: now), else '' (with a
    warning on stderr). A time that can't be read is '' too."""
    from datetime import timedelta
    if not interview_at:
        return ''
    floor = datetime.min.replace(tzinfo=timezone.utc)
    when = moment(str(interview_at))
    if when == floor:
        return ''
    said = moment(str(said_at or ''))
    said = datetime.now(timezone.utc) if said == floor else said
    if when < said - timedelta(days=PAST_INTERVIEW_DAYS) or when > said + timedelta(days=FUTURE_INTERVIEW_DAYS):
        print(f'Interview time {str(interview_at)[:16]} not saved: impossible for a message of {said:%Y-%m-%d}',
              file=sys.stderr)
        return ''
    return interview_at



def _link_ids(event):
    return {link['id'].replace('-', '') for link in (event['properties'].get('Application') or {}).get('relation', [])}


def event_interview_at(event):
    """The interview time an event's Changes column records (JSON written by src/ai/mail.py), or ''."""
    text = plain((event['properties'] or {}).get('Changes')) or ''
    try:
        return str(json.loads(text).get('interview_at') or '') if text.startswith('{') else ''
    except (ValueError, AttributeError):
        return ''


# How close two same-kind events have to be to be one occurrence: a duplicate report of the same thing (the same
# email from two sources, a watcher and the app, a hand-logged twin), never a genuinely later one. Without a bound,
# an application's *second* "Confirmation received" — or a re-rejection weeks later — was swallowed forever
# (1 Oct 2026: Canonical's confirmation vanished into the rejected row's month-old event).
SAME_OCCURRENCE_HOURS = 24


def _same_occurrence(event, when, hours=SAME_OCCURRENCE_HOURS):
    """True when an existing event is the same occurrence as one at `when`. An event with no readable time counts as
    the same (the old behaviour), rather than creating a twin on every read."""
    recorded = plain(event['properties'].get('At')) or ''
    if not recorded:
        return True
    try:
        datetime.fromisoformat(recorded.replace('Z', '+00:00'))
    except ValueError:
        return True
    return abs((moment(recorded) - when).total_seconds()) <= hours * 3600


def moment(value):
    """An event time as a comparable UTC datetime. A date without a time counts as midnight in the
    owner's time zone (JOB_PILOTTO_TZ), so "2026-09-26" sorts before a 01:26 email that day even
    when Notion returns the email in UTC ("2026-09-25T23:26Z"). Unparseable -> the earliest time."""
    from zoneinfo import ZoneInfo
    value = (value or '').replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz.local_zone())
    return parsed.astimezone(timezone.utc)
