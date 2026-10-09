"""📥 Log anything, part 5: the last message of a conversation as an event on the job, and the note an event carries.
Re-exported by src/ai/inbox.py. Tests: tests/test_inbox.py, tests/test_inbox_gaps.py.
"""
import hashlib
import re
from datetime import date

from ..notion.ledger import REPLY
from ..stores import rules
from . import added, mail, opportunity
from .inbox_reading import OUTREACH


THEIRS = {OUTREACH, 'Confirmation received', REPLY, 'Interview scheduled', 'Rejected', 'Offer', mail.employer_feedback.RECEIVED}


def last_message_id(last):
    """The last message's fingerprint (Source ID): who, when, its first words. The same message logged again, from
    another screenshot or another day, is the same event."""
    words = re.sub(r'\s+', ' ', last.get('text_snippet') or '').strip().lower()[:120]
    return 'chat:' + hashlib.sha256(f"{last.get('from')}|{last.get('resolved')}|{words}".encode()).hexdigest()[:16]


def _noted(text, item, limit=300):
    """An event's note, with the scheduling link they sent when there is one ("Booking link: https://calendly.com/…"): Focus
    shows "Book the call" with a button that opens it (src/focus.py). Only a web address is kept."""
    link = (item.get('booking_link') or '').strip()
    if not re.match(r'https?://\S+$', link) or len(link) > 200:
        return text[:limit]
    suffix = f' Booking link: {link}'
    return text[:limit - len(suffix)] + suffix


def _last_message(stores, app, item, source, kind):
    """Who wrote last in the conversation, as an event on the job (📈 Application Events, idempotent): yours =
    "Replied" (Focus recommends a follow-up when it stays unanswered), theirs = "Reply received" (Focus: reply),
    unless the log's own event already is their message (rules.add_event: a repeat is not saved twice). Nothing when the day is unknown (the app asks it). Returns
    the sentence for the reply, or '' when nothing new was saved."""
    last = item.get('last_message') or {}
    who, at = last.get('from'), last.get('resolved') or ''
    if who not in ('you', 'them') or not mail._when(at if 'T' in at else f'{at}T12:00:00') or (who == 'them' and kind in THEIRS):
        return ''
    snippet = re.sub(r'\s+', ' ', last.get('text_snippet') or '').strip()[:120]
    _, existing = rules.add_event(stores, app, mail.YOU_REPLIED if who == 'you' else REPLY, source, at=at,
                      note=_noted((f'You wrote: {snippet}' if who == 'you' else f'They wrote: {snippet}') if snippet else
                                  ('Your last message' if who == 'you' else 'Their last message'), item if who == 'them' else {}),
                      source_id=last_message_id(last))
    if existing:
        return ''
    day = date.fromisoformat(at[:10])
    said = f'{day:%a} {day.day} {day:%b}'
    return (f'Your last message was on {said}: saved so Focus can remind you to follow up.' if who == 'you'
            else f'Their last message was on {said}, waiting for your answer: saved for Focus.')


def _check_line(check):
    return f" ⚠️ Check: {'; '.join(check)}." if check else ''


def _rich(on_new, app, item, text):
    """The AI stages for a job tracked here for the first time (see src/ai/added.py)."""
    if not on_new:
        return None
    url = app.get('url') or ''
    job = {'title': opportunity.title(item), 'company': item.get('company') or '', 'location': item.get('location') or '',
           'work_mode': item.get('work_mode') or '', 'description': added.description_of(item, text)}
    return on_new(url, job, app)
