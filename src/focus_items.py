#!/usr/bin/env python3
"""Focus, part 1: the constants (time zone, targets, who-wrote-last sets) and the small helpers every Focus item is
made from: reading a field, a time or "N days ago", an item dict, the presented item, the list's summary line,
and the questions the app already asked. Rows are store records (src/stores/base.py), events and interviews too;
an application's record carries 'link' (its page, when the store has one). No I/O. src/focus.py re-exports every
name here.

Guarded by tests/test_focus.py, tests/test_follow_up.py and tests/test_job_titles.py.
"""
import re
from datetime import datetime, timezone

from . import tz
from .notion.ledger import REPLY

TZ = tz.local_zone()

DEFAULT_TARGET = 5  # fewer, better applications: a handful of good-fit ones a day
REPLIED = 'Replied'
ENDED = {'Rejected', 'Withdrawn', 'No response', 'Closed', 'Dismissed'}
# Events that come from the other side and wait for an answer; anything later (your reply, a booking) settles them.
NEEDS_ANSWER = {REPLY, 'Recruiter lead', 'Offer'}
WAITING_DAYS, QUIET_DAYS, SOON_HOURS, STALE_DAYS = 7, 3, 48, 30
FOLLOW_UP_HOURS = 24  # your message unanswered this long: Focus recommends a follow-up
# Messages, for "who wrote last": yours (a reply you sent or logged, Done in Focus) and theirs. Stage moves and
# the app's own bookkeeping are not messages.
YOURS = {REPLIED}
THEIRS = NEEDS_ANSWER | {'Interview scheduled', 'Rejected', 'Confirmation received', 'Feedback received'}


def _when(value):
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=TZ)


def _ago(moment, now):
    days = (now.astimezone(TZ).date() - moment.astimezone(TZ).date()).days
    return 'today' if days <= 0 else 'yesterday' if days == 1 else f'{days} days ago'


def _field(row, name):
    """A record's field as text-ish ('' when empty or no record)."""
    value = (row or {}).get(name)
    return '' if value is None else value


def _role(row):
    """The job's role: a record's title is the role alone (the notion store drops the " · via Huxley" a page title
    carries, src/notion/titles.py): every Focus line names the employer or agency itself."""
    return _field(row, 'title') if row else ''


def _asked_subject(event):
    """The email subject of a "which job?" question (src/ai/mail.py ask: the event's changes['subject'])."""
    return str((event.get('changes') or {}).get('subject') or '')


def answered_questions(rows, events):
    """The "which job?" questions you have answered, newest first: the email's subject and the job it went to ('' = not
    about a job). The Gmail check's run page shows the question next to its answer from this."""
    by_id = {r['id'].replace('-', ''): r for r in rows}
    out = []
    for event in events:
        subject = _asked_subject(event)
        if not subject or event.get('needs_you'):
            continue
        row = by_id.get(event['app_id'].replace('-', '')) if event.get('app_id') else None
        job = f"{_field(row, 'company') or _field(row, 'via') or '?'} — {_role(row)[:60]}" if row else ''
        out.append({'subject': subject, 'job': job, 'at': event.get('at') or ''})
    return sorted(out, key=lambda a: a['at'], reverse=True)[:60]


def _gmail(source_id):
    """The Gmail link of a message id. Only Gmail's own ids: a calendar event ("cal:") and a chat or screenshot you logged
    ("paste:", "chat:") are not emails, so a LinkedIn conversation never gets an "Open email" button."""
    return f'https://mail.google.com/mail/u/0/#all/{source_id}' if source_id and not source_id.startswith(('cal:', 'paste:', 'chat:')) else ''


def _booking_link(note):
    """The scheduling link the log saved in an event's note ("Booking link: https://calendly.com/…"), '' when none."""
    found = re.search(r'Booking link:\s*(https?://[^\s<>"\')]+)', note or '')
    return found.group(1).rstrip('.,;') if found else ''


def _item(priority, kind, emoji, title, detail, row=None, link='', link_label='', done=False, **extra):
    field = lambda name: _field(row, name) if row else ''
    return {'priority': priority, 'kind': kind, 'emoji': emoji, 'title': title, 'detail': detail,
            'company': field('company'), 'job': _role(row), 'via': field('via'), 'stage': field('stage'),
            'salary': field('salary'), 'location': field('location'), 'reached': field('reached_via'),
            'job_url': field('url'), 'page_id': row['id'] if row else '',
            'notion_url': (row or {}).get('link', ''), 'link': link, 'link_label': link_label, 'done': done, **extra}


def _short(text, limit=28):
    text = re.sub(r'\s+', ' ', text or '').strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip(' ,·(') + '…'


def present(item, gmail=True):
    """The card's words (the app's Up next list): an icon, a badge, a short headline and a meta line."""
    kind, who = item['kind'], item['company'] or item['via'] or 'the recruiter'
    meta = []
    if kind in ('reply', 'book', 'offer'):
        reached = item['reached'] or ('LinkedIn' if 'linkedin' in item['link'] else 'Email' if 'mail.google' in item['link'] else '')
        icon, badge, tone = {'reply': ('chat' if reached == 'LinkedIn' else 'mail' if reached == 'Email' else 'chat', 'Reply today', 'bad'),
                             'book': ('calendar', 'Book the call', 'bad'), 'offer': ('target', 'Offer', 'good')}[kind]
        headline = {'reply': f"Reply to {who} recruiter" if item.get('lead') else f'Reply to {who}',
                    'book': f'Book a call with {who}', 'offer': f"Answer {who}'s offer"}[kind]
        meta = [_short(item['job'], 40), reached, _short(item['salary']), _short(item['location'])]
    elif kind == 'prepare':
        at = _when(item.get('at', ''))
        icon, badge, tone = 'mic', f"Interview {at.astimezone(TZ):%a %H:%M}" if at else 'Interview', 'bad' if item['priority'] == 1 else 'warn'
        headline = f'Prepare for {who}'
        meta = [_short(item['job'], 40), item.get('prep_reason') if item.get('prep_stale') else
                '✓ prep kit ready' if item.get('prep_at') else 'posting, kit and weak topics']
    elif kind == 'review':
        icon, badge, tone = 'file', 'Review', 'warn'
        headline, meta = f'Review your {who} interview', [_short(item['job'], 40), 'import the recording or transcript']
    elif kind == 'follow_up':
        at = _when(item.get('at', ''))
        icon, badge, tone = 'send', 'Follow up', 'warn'
        headline = f'Follow up with {who}'
        meta = [_short(item['job'], 40), f"you wrote {at.astimezone(TZ):%a %d %b}" if at else '',
                f"{_days_ago(item.get('quiet', 0), short=True)}, no reply"]
    elif kind == 'nudge':
        quiet = item.get('quiet', 0)
        icon, badge, tone = 'send', 'Follow up', 'warn'
        headline = f'Move {who} forward'
        meta = [_short(item['job'], 40), item['stage'], f'no news for {quiet} days' if quiet >= QUIET_DAYS else 'nothing booked']
    elif kind in ('feedback', 'feedback_wait', 'feedback_review'):
        icon, badge, tone = 'chat', {'feedback': 'Learn from it', 'feedback_wait': 'Asked for feedback',
                                    'feedback_review': 'Received feedback'}[kind], 'info'
        headline = {'feedback': f'Ask {who} for feedback', 'feedback_wait': f'Waiting for {who} feedback',
                    'feedback_review': f'Learn from {who} feedback'}[kind]
        meta = [_short(item['job'], 40), {'feedback': 'One specific point can improve your next interview',
                # Only a connected Gmail is checked: without it the row would promise replies nobody collects (#312).
                'feedback_wait': 'Gmail checks for replies · or add feedback here' if gmail else 'Connect Gmail to collect replies · or add feedback here',
                'feedback_review': 'Employer feedback, separate from AI guesses'}[kind]]
    elif kind == 'which_job':
        icon, badge, tone = 'mail', 'Which job?', 'warn'
        headline = item['title']
        meta = [item.get('event_kind', ''), _short(item.get('note', ''), 60)]
    elif kind == 'details':
        icon, badge, tone = 'info', 'Add details', 'bad' if item['stage'] == 'Interview scheduled' else 'warn'
        headline = f"Tell Job Pilotto about the {who} interview" if item['company'] or 'company' not in item.get('missing', []) \
            else f'Who is the employer behind {who}?'
        meta = [_short(item['job'], 40), 'missing: ' + ', '.join(item.get('missing', []))]
    elif kind == 'apply':
        done, left, kits = item.get('applied', 0), item.get('left', 0), item.get('kits', 0)
        icon, badge, tone = 'briefcase', 'Next step', 'info'
        headline = 'Apply to your next role' if not done else f'Apply to {left} more today'
        meta = [f'{kits} application kit{"s" if kits != 1 else ""} ready to review' if kits else 'Prepare kits from your best matches',
                f"{done} of {item.get('target', DEFAULT_TARGET)} today"]
    elif kind == 'happened':
        at = _when(item.get('at', ''))
        icon, badge, tone = 'calendar', 'Did it happen?', 'warn'
        headline = f'Interview with {who}'  # the badge asks "Did it happen?"
        meta = [_short(item['job'], 40), f"{at.astimezone(TZ):%a %d %b %H:%M}" if at else '']
    elif kind == 'waiting' and item.get('after_interview'):
        icon, badge, tone = 'pulse', 'Waiting', 'neutral'
        headline = f"Waiting for {who}'s next step"
        meta = [_short(item['job'], 40), _short(item.get('next_step') or 'next step not stated', 60)]
    else:  # waiting
        icon, badge, tone = 'pulse', 'When you can', 'neutral'
        headline, meta = item['title'], ['No human reply yet', 'follow up or let them go']
    item.update(icon=icon, badge=badge, tone=tone, headline=headline, meta=[m for m in meta if m])
    return item


def summary(items):
    """One sentence for "Your focus": the first two kinds of work, in order."""
    phrases = {'offer': 'answer the offer', 'book': 'book the call you were invited to', 'reply': 'reply to recruiters',
               'prepare': 'prepare for your interview', 'review': 'review your last interview',
               'happened': 'confirm your last interview happened', 'nudge': 'follow up where things went quiet',
               'follow_up': 'follow up where your message got no answer',
               'apply': 'review ready applications', 'waiting': 'follow up on applications waiting for a reply',
               'feedback': 'ask for feedback to improve your next interview', 'feedback_review': 'learn from employer feedback'}
    order = []
    for item in items:
        phrase = None if item.get('after_interview') else phrases.get(item['kind'])
        if phrase and phrase not in order:
            order.append(phrase)
    if not order:
        return "You're up to date. A good moment to apply to a few more jobs."
    text = order[0][0].upper() + order[0][1:]
    return f'{text} first, then {order[1]}.' if len(order) > 1 else f'{text}.'


def _days_ago(days, short=False):
    """"yesterday" / "3 days ago" (short: "1 day" / "3 days")."""
    if short:
        return f"{days} day{'s' if days != 1 else ''}"
    return 'yesterday' if days <= 1 else f'{days} days ago'
