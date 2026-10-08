"""📥 Log anything, part 4: the confirmation step's questions (fields: ok / check / ask), the agreement to talk, and what an
unconfirmed log took on trust. Re-exported by src/ai/inbox.py. Tests: tests/test_inbox_confirm.py, tests/test_inbox.py.
"""
from ..notion import ledger
from ..notion import origin as origin_rule
from . import mail, opportunity
from .inbox_dates import _years
from .inbox_reading import AGREE_QUESTION, AGREEMENT, APPLIED, KINDS, NOT_JOB


CHANNELS = ('LinkedIn', 'Email', 'Phone', 'Other')  # the app's "Where is this conversation from?"


def _as_written(text):
    return f' "{text.strip()[:40]}"' if (text or '').strip() else ''


# Kinds that never announce a call still to come: a time read in them ("THURSDAY 8:34 AM" above a rejection) is the message's own, not a call's.
NO_CALL = ('Rejected', APPLIED, 'Confirmation received', mail.employer_feedback.RECEIVED)
UPDATE = 'Update on this job'  # the app's "What is it?" for a job already tracked that has nothing new of its own kind


def agreement(item):
    """Did the owner agree to talk ('shown', 'declined', 'none', 'unclear'): the reading's seen.agreement, else (a
    reading without it) owner_agreed."""
    said = (item.get('seen') or {}).get('agreement')
    return said if said in AGREEMENT else 'shown' if item.get('owner_agreed') else 'none'


def agree_applies(new, stage):
    """Saying yes to the recruiter moves only a new job or a Recruiter lead (to Screening); any other job is past it."""
    return new or stage == opportunity.LEAD_STAGE


def agreed(item):
    """Whether the job moves to Screening for this log: your answer in the app (item['agreed']) when given, else
    what the conversation shows ('shown' only)."""
    return bool(item['agreed']) if item.get('agreed') is not None else agreement(item) == 'shown'


def fields(item, kind, *, new, now, stage='', first_known=None, current=None):
    """What the app's confirmation step asks, each field {value, state, question…}: state "ok" = shown in the item
    (pre-filled), "check" = inferred (pre-filled, marked "please check", to be confirmed), "ask" = not shown at all
    (left empty, with a question). Nothing is written before every required one is confirmed. A job already
    tracked defaults to "Update on this job" (UPDATE) when the reading has nothing of its own kind (a first contact
    for a job you're already talking about): that's no guess, so it isn't marked. "agree" (did you agree to talk?) is
    only there for a new job or a Recruiter lead: shown in the conversation = pre-filled yes; 'unclear' = asked;
    'none' or 'declined' = not there (the job stays where it is)."""
    seen = item.get('seen') or {}
    platform = item.get('platform') if item.get('platform') in CHANNELS else ''
    channel_state = {'shown': 'ok', 'guessed': 'check'}.get(seen.get('channel'), 'ask' if not platform or platform == 'Other' else 'check')
    options = [k for k in KINDS if k != NOT_JOB]
    out = {
        'kind': {'value': kind, 'state': 'ok' if kind == UPDATE else 'check', 'options': options if new else [UPDATE] + options},
        'channel': {'value': platform if channel_state != 'ask' else '', 'state': channel_state,
                    'guess': platform, 'question': 'Where is this conversation from?'},
    }
    began = item.get('first_contact') if mail._when(item.get('first_contact') or '') else item.get('when') or ''
    written = item.get('first_contact_text') or ''
    if not mail._when(began):
        out['started'] = {'value': '', 'state': 'ask', 'question': 'When did it start?'}
    elif item.get('first_contact_resolved'):  # "MONDAY" above the first message: that Monday (resolve_day), no question
        out['started'] = {'value': began[:10], 'state': 'ok', 'question': 'When did it start?', 'as_written': written.strip()[:40]}
    elif seen.get('year') == 'missing':
        # "Sep 21" in a chat: which year is asked, never assumed (it once became 21 Sep 2024).
        out['started'] = {'value': '', 'state': 'ask', 'month_day': began[5:10], 'years': _years(began, now),
                          'question': f'Which year was{_as_written(written) or " " + began[5:10]}?'}
    else:
        out['started'] = {'value': began[:10], 'state': 'ok' if seen.get('first_contact', 'shown') == 'shown' else 'check',
                          'question': 'When did it start?'}
    interview, when_text = seen.get('interview') or ('shown' if item.get('interview_at') else 'none'), item.get('interview_text') or ''
    if interview != 'none' or kind == 'Interview scheduled':
        full = (interview == 'shown' and seen.get('year') != 'missing' and mail._when(item.get('interview_at') or '')
                and ledger.plausible_interview(item['interview_at'], now))  # a misread year is asked, never shown
        out['interview'] = {'value': item['interview_at'][:16] if full else '', 'state': 'ok' if full else 'ask',
                            'required': kind == 'Interview scheduled',
                            'question': 'When is the call?', 'as_written': when_text.strip()[:40]}
    if new:
        company_state = {'shown': 'ok', 'guessed': 'check'}.get(seen.get('company'), 'ask')
        out['company'] = {'value': item.get('company') or '' if company_state != 'ask' else '', 'state': company_state,
                          'required': False, 'question': 'Which company is hiring?'}
        out['agency'] = {'value': '' if item.get('in_house') else item.get('recruiter_company') or '', 'state': 'ok',
                         'required': False, 'question': 'Agency (if a recruiter found you)'}
    last = item.get('last_message') or {}
    if last.get('from') in ('you', 'them'):
        # Who wrote last and when: saved as an event so Focus can say "follow up" (yours unanswered) or "reply".
        # A day that can't be read is asked, never guessed; left empty, nothing is saved about it.
        moment = last.get('resolved') or ''
        out['last'] = {'value': moment[:10], 'state': 'ok' if moment else 'ask', 'required': False, 'from': last['from'],
                       'snippet': last.get('text_snippet') or '', 'as_written': (last.get('at_text') or '').strip()[:40],
                       'question': 'When was the last message?'}
    if _asks_origin(item, current, first_known):
        out['origin'] = {'value': '', 'state': 'ask', 'required': False, 'question': 'Who reached out first?',
                         'current': (current or {}).get('Origin') or '', 'first_known': first_known.isoformat()}
    said = agreement(item)
    if agree_applies(new, stage) and said in ('shown', 'unclear'):
        out['agree'] = {'value': 'yes' if said == 'shown' else '', 'state': 'ok' if said == 'shown' else 'ask',
                        'question': AGREE_QUESTION}
    return out


def _asks_origin(item, current, first_known):
    """Who reached out first is asked for a tracked Outbound job when the conversation may predate its first contact:
    it began before it, or the day isn't known yet (the window asks only once the day you confirm is earlier)."""
    if not current or first_known is None or origin_rule.stored(current.get('Origin')) != origin_rule.OUTBOUND:
        return False
    began = mail._when(item.get('first_contact') or '') or mail._when(item.get('when') or '')
    return began is None or began < first_known or (item.get('seen') or {}).get('year') == 'missing'


def unchecked(item, kind):
    """What a log that wasn't confirmed (Telegram, the terminal) took on trust, for its reply and its page entry."""
    seen, notes = item.get('seen') or {}, []
    if seen.get('year') == 'missing' and not item.get('first_contact_resolved') and (item.get('when') or item.get('first_contact')):
        notes.append(f"year assumed{_as_written(item.get('first_contact_text'))}")
    if seen.get('channel') != 'shown':
        notes.append(f"channel {item.get('platform') or 'unknown'} guessed")
    if seen.get('interview') == 'partial' and item.get('interview_at'):
        notes.append(f"call time guessed{_as_written(item.get('interview_text'))}")
    if kind != UPDATE:  # "Update on this job" follows from the job being tracked, not from Claude's reading
        notes.append(f'kind "{kind}" read by Claude')
    return notes
