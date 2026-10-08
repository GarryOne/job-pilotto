"""How the check names and reports a job: ask() for an email it cannot place, the run's short update lines and Telegram headings.
Guarded by tests/test_mail_ask.py."""
from html import escape
import re
import urllib.error

from .. import tgcard
from ..notion.ledger import EVENTS_DATABASE_ID, REPLY
from . import opportunity
from .. import feedback as employer_feedback
from .mail_config import OUTREACH, YOU_REPLIED
from .mail_read import _field, _role
from .mail_record import NEW_COLUMNS, changes_text


# ---- Not sure which job: ask ----
# An email the check can't place for certain becomes an event on no job, with "Needs you" and the job it would
# have picked ("Suggested job"): Focus asks "Is this about …?" and src/ai/reassign.py applies the answer.
EVENT_KIND = {OUTREACH: opportunity.LEAD_STAGE}


def ask(tracker, email, result, suggested, index, lines, stats):
    kind = EVENT_KIND.get(result['kind'], result['kind'])
    subject = email['subject'][:120]
    properties = {
        'Event': {'title': [{'text': {'content': f'❓ Which job? · {subject}'[:200]}}]},
        'Kind': {'select': {'name': kind}}, 'At': {'date': {'start': email['date']}}, 'Source': {'select': {'name': 'Gmail'}},
        'Note': {'rich_text': [{'text': {'content': f"{result.get('summary') or kind} (email: \"{subject}\")"[:1990]}}]},
        'Source ID': {'rich_text': [{'text': {'content': email['id']}}]}, 'Needs you': {'checkbox': True},
        'Changes': changes_text({}, result.get('interview_at') or None, email, result.get('feedback') or ''),
    }
    if suggested is not None and _field(suggested, 'Job URL'):
        properties['Suggested job'] = {'url': _field(suggested, 'Job URL')}
    try:
        tracker.create_page(EVENTS_DATABASE_ID, properties)
    except urllib.error.HTTPError:  # a workspace without the new columns yet (the app adds them): the question still
        tracker.create_page(EVENTS_DATABASE_ID, {k: v for k, v in properties.items() if k not in NEW_COLUMNS})
    index[0].add(email['id'])
    guess = f" (maybe {_label(suggested)})" if suggested is not None else ''
    lines.append(tgcard.block('Which job is this for?', escape(result.get('company') or email['subject'][:60]) + ': '
                              + escape(result.get('summary') or kind) + (f' Maybe {_label(suggested)}.' if suggested is not None else ''),
                              tgcard.fact('Next step', 'answer in Job Pilotto: Focus')))
    if stats is not None:
        stats.setdefault('updates', []).append(f"❓ {kind} · {result.get('company') or subject[:60]} — which job?"[:140])


EMOJI = {YOU_REPLIED: '↩️', 'Confirmation received': '📬', REPLY: '💬', OUTREACH: '🤝', 'Interview scheduled': '🗓', 'Rejected': '❌', 'Offer': '🎉', 'Other': '•', employer_feedback.RECEIVED: '💬'}


SHORT_KIND = {'Confirmation received': 'Application received', YOU_REPLIED: 'You replied'}


def _short(stats, kind, row, extra='', changes=''):
    """One short plain line per recorded update, for the desktop app and the run's page: what was recorded on which job
    and — the part that was missing — what it changed there ("📬 Application received · Canonical — SRE · Stage Applied →
    Confirmation received; Confirmation email set")."""
    if stats is not None:
        job = re.sub(r'\s*\|\s*Remote\s*$', '', _role(row))[:70]
        detail = f" · {changes}" if changes else ''
        stats.setdefault('updates', []).append(
            f"{EMOJI.get(kind, '•')} {SHORT_KIND.get(kind, kind)} · {_who(row)} — {job}{extra}{detail}")


def _who(row):
    """The employer, or for a recruiter lead with a hidden one, the agency."""
    return _field(row, 'Company') or _field(row, 'Via') or _field(row, 'Contact').split(' · ')[0] or '?'


def _head(row, kind=''):
    """Bold heading of a Telegram block: 'Company · Role · Kind'."""
    return tgcard.dot(escape(_who(row)), escape(_role(row))[:60], escape(SHORT_KIND.get(kind, kind)))


def _label(row):
    return f"{escape(_who(row))} — {escape(_role(row))[:60]}"
