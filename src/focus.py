#!/usr/bin/env python3
"""Focus: what to do next in the job search, most important first. No AI, so it costs nothing.

Read from Notion (Applications, 📈 Application Events, 🎤 Interviews), in this order:
1. 💬 Reply: a person wrote (a reply, a recruiter's pitch, an offer) and nothing was done since.
   📅 Book the call: the reply invites you to pick a slot.
2. 🎤 Prepare: an interview is coming (within 48 h first), or 📝 review one that just happened.
   🤝 Move it forward: a Screening with nothing booked and no news for 3 days.
3. 📨 Apply: today's applications against the daily target, with the jobs whose kit is ready.
4. 🔎 Learn: the latest rejection lesson; ⏳ applications waiting 7+ days without a human reply.

"Done" on a reply item logs a "Replied" event (Notion keeps it; the item then goes away). The Desktop App shows
the list (Focus) and, at 11:00, 15:00 and 19:00, reminds you (notification, and Telegram with --send) when
you're behind the daily target or someone waits for an answer.

Usage:
  python -m src.focus [--target 30]            # the list as JSON (for the app); the target defaults to
                                               # "Daily applications target" on ⚙️ Search settings
  python -m src.focus done <page id> replied   # you answered: log it
  python -m src.focus history                   # what you resolved from Focus (Notion), newest first
  python -m src.focus remind [--target 30] [--send]
"""
import argparse
from datetime import date, datetime, timedelta, timezone
from html import escape
import json
import os
import re
import sys
from zoneinfo import ZoneInfo

from . import telegram
from . import feedback
from .features import disabled
from .notion import client as notion
from .notion import funnel as funnel_steps
from .notion.ledger import EVENTS_DATABASE_ID, OUTCOME_STAGES, REPLY, add_event, plain

TZ = ZoneInfo(os.getenv('JOB_PILOTTO_TZ', 'Europe/Zurich'))
INTERVIEWS_DATABASE_ID = os.getenv('NOTION_INTERVIEWS_DB', '')
INSIGHTS_DATABASE_ID = os.getenv('NOTION_INSIGHTS_DB', '')
DEFAULT_TARGET = 30
REPLIED = 'Replied'
ENDED = {'Rejected', 'Withdrawn', 'No response', 'Closed', 'Dismissed'}
# Events that come from the other side and wait for an answer; anything later (your reply, a booking) settles them.
NEEDS_ANSWER = {REPLY, 'Recruiter lead', 'Offer'}
BOOKING = re.compile(r'\b(book|slot|schedul|calendly|cal\.com|availability|available|pick a time|time that works)', re.I)
WAITING_DAYS, QUIET_DAYS, SOON_HOURS = 7, 3, 48


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
    return plain(row['properties'].get(name)) or ''


def _gmail(source_id):
    return f'https://mail.google.com/mail/u/0/#all/{source_id}' if source_id and not source_id.startswith('cal:') else ''


def _item(priority, kind, emoji, title, detail, row=None, link='', link_label='', done=False, **extra):
    field = lambda name: _field(row, name) if row else ''
    return {'priority': priority, 'kind': kind, 'emoji': emoji, 'title': title, 'detail': detail,
            'company': field('Company'), 'job': field('Job'), 'via': field('Via'), 'stage': field('Stage'),
            'salary': field('Salary'), 'location': field('Location'), 'reached': field('Reached via'),
            'job_url': field('Job URL'), 'page_id': row['id'] if row else '',
            'notion_url': (row or {}).get('url', ''), 'link': link, 'link_label': link_label, 'done': done, **extra}


def _short(text, limit=28):
    text = re.sub(r'\s+', ' ', text or '').strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip(' ,·(') + '…'


def present(item):
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
        headline, meta = f'Prepare for {who}', [_short(item['job'], 40), 'posting, kit and weak topics']
    elif kind == 'review':
        icon, badge, tone = 'file', 'Review', 'warn'
        headline, meta = f'Review your {who} interview', [_short(item['job'], 40), 'import the recording or transcript']
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
                'feedback_wait': 'Gmail checks for replies · or add feedback here',
                'feedback_review': 'Employer feedback, separate from AI guesses'}[kind]]
    elif kind == 'which_job':
        icon, badge, tone = 'mail', 'Which job?', 'warn'
        headline = item['title']
        meta = [item.get('event_kind', ''), _short(item.get('note', ''), 60)]
    elif kind == 'details':
        icon, badge, tone = 'info', 'Add details', 'bad' if item['stage'] == 'Interview scheduled' else 'warn'
        headline = f"Tell Job Pilotto about the {who} interview" if item['company'] else f'Which job is the {who} interview for?'
        meta = [_short(item['job'], 40), 'missing: ' + ', '.join(item.get('missing', []))]
    elif kind == 'apply':
        done, left, kits = item.get('applied', 0), item.get('left', 0), item.get('kits', 0)
        icon, badge, tone = 'briefcase', 'Next step', 'info'
        headline = 'Apply to your next role' if not done else f'Apply to {left} more today'
        meta = [f'{kits} application kit{"s" if kits != 1 else ""} ready to review' if kits else 'Prepare kits from your best matches',
                f"{done} of {item.get('target', DEFAULT_TARGET)} today"]
    else:  # waiting
        icon, badge, tone = 'pulse', 'When you can', 'neutral'
        headline, meta = item['title'], ['No human reply yet', 'follow up or let them go']
    item.update(icon=icon, badge=badge, tone=tone, headline=headline, meta=[m for m in meta if m])
    return item


def summary(items):
    """One sentence for "Your focus": the first two kinds of work, in order."""
    phrases = {'offer': 'answer the offer', 'book': 'book the call you were invited to', 'reply': 'reply to recruiters',
               'prepare': 'prepare for your interview', 'review': 'review your last interview', 'nudge': 'follow up where things went quiet',
               'apply': 'review ready applications', 'waiting': 'follow up on applications waiting for a reply',
               'feedback': 'ask for feedback to improve your next interview', 'feedback_review': 'learn from employer feedback'}
    order = []
    for item in items:
        phrase = phrases.get(item['kind'])
        if phrase and phrase not in order:
            order.append(phrase)
    if not order:
        return "You're up to date. A good moment to apply to a few more jobs."
    text = order[0][0].upper() + order[0][1:]
    return f'{text} first, then {order[1]}.' if len(order) > 1 else f'{text}.'


def _events_by_app(events):
    by_app = {}
    for event in events:
        props = event['properties']
        for link in (props.get('Application') or {}).get('relation', []):
            by_app.setdefault(link['id'].replace('-', ''), []).append(
                {'kind': plain(props.get('Kind')), 'at': _when(plain(props.get('At')) or ''), 'note': plain(props.get('Note')) or '',
                 'source_id': plain(props.get('Source ID')) or ''})
    for items in by_app.values():
        items.sort(key=lambda e: e['at'] or datetime.min.replace(tzinfo=timezone.utc))
    return by_app


def _interviewed(interviews):
    """Application page id -> the latest day an interview of it was saved in 🎤 Interviews."""
    days = {}
    for row in interviews:
        day = (plain(row['properties'].get('Date')) or '')[:10]
        for link in (row['properties'].get('Application') or {}).get('relation', []):
            key = link['id'].replace('-', '')
            days[key] = max(days.get(key, ''), day)
    return days


def _applied_today(rows, by_app, today):
    ids = {r['id'] for r in rows if _field(r, 'Applied on')[:10] == today.isoformat()}
    ids |= {key for key, events in by_app.items()
            if any(e['kind'] == 'Applied' and e['at'] and e['at'].astimezone(TZ).date() == today for e in events)}
    return len({i.replace('-', '') for i in ids})


# A job known only from an invitation or a message: its Job URL is the email, the chat or a derived link.
PLACEHOLDER_URL = re.compile(r'mail\.google\.com|linkedin\.com/messaging|jobpilotto\.workers\.dev/lead')


def thin(row):
    """What an interviewing job still lacks that you'd want before the call ([] when it's known well enough):
    the employer, or both the pay and the posting (only the meeting or the message is known)."""
    missing = [] if _field(row, 'Company') else ['company']
    if not _field(row, 'Salary') and PLACEHOLDER_URL.search(_field(row, 'Job URL')):
        missing += ['salary', 'job description']
    return missing


def questions(rows, events):
    """Emails the Gmail check wasn't sure about (events on no job with Needs you, src/ai/mail.py ask): "Is this
    about …?" with the likeliest job, or "Which job is this email about?". src/ai/reassign.py applies the answer."""
    by_url = {_field(r, 'Job URL'): r for r in rows if _field(r, 'Job URL')}
    asked = []
    for event in events:
        props = event.get('properties', {})
        if not (props.get('Needs you') or {}).get('checkbox') or (props.get('Application') or {}).get('relation'):
            continue
        suggested = by_url.get((props.get('Suggested job') or {}).get('url') or '')
        note, kind = plain(props.get('Note')), plain(props.get('Kind'))
        at = _when(((props.get('At') or {}).get('date') or {}).get('start') or '')
        label = f"{_field(suggested, 'Company') or _field(suggested, 'Via') or '?'} — {_field(suggested, 'Job')[:60]}" if suggested else ''
        title = f'Is this email about {label}?' if suggested else 'Which job is this email about?'
        detail = f"{kind}{f', {at.astimezone(TZ):%a %d %b %H:%M}' if at else ''}: {note[:220]}"
        asked.append(_item(1, 'which_job', '❓', title, detail, suggested, event_id=event['id'], event_kind=kind, note=note,
                           suggested_url=_field(suggested, 'Job URL') if suggested else '', suggested_label=label))
    return asked


def build(rows, events, interviews=(), *, target=DEFAULT_TARGET, now=None, insights=()):
    """{'items': [...], 'today': {...}}: the focus list, most important first. Pure: no I/O."""
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(TZ).date()
    by_app, interviewed, items = _events_by_app(events), _interviewed(interviews), []
    for row in rows:
        stage, key = _field(row, 'Stage'), row['id'].replace('-', '')
        history = by_app.get(key, [])
        status = _field(row, 'Feedback status')
        kinds = {e['kind'] for e in history}
        received = _field(row, 'Employer feedback')
        last_received = max((e['at'] for e in history if e['kind'] == feedback.RECEIVED and e['at']), default=None)
        last_reviewed = max((e['at'] for e in history if e['kind'] == feedback.REVIEWED and e['at']), default=None)
        if not disabled('feedback') and received and (not last_reviewed or (last_received and last_received > last_reviewed)):
            detail = 'Read their feedback, then choose what to practise before your next interview. It also feeds your insights and weekly report.'
            items.append(_item(2, 'feedback_review', '💬', 'Learn from employer feedback', detail, row, employer_feedback=received))
        if stage == 'Rejected':
            if received or feedback.SKIPPED in kinds or status == 'Skipped':
                continue
            if feedback.REQUESTED in kinds or status == 'Asked for feedback':
                kind, detail = 'feedback_wait', 'Your request is sent. Gmail checks will collect their reply; you can also paste feedback here.'
            elif feedback.eligible(row, history):
                kind, detail = 'feedback', 'You reached Screening or later. Ask for one or two concrete points: real feedback helps improve your next interview.'
            else:
                continue
            rejection = next((e for e in reversed(history) if e['kind'] == 'Rejected'), {})
            items.append(_item(4 if kind == 'feedback_wait' else 2, kind, '💬', 'Ask for feedback', detail, row,
                               _gmail(rejection.get('source_id')), 'Open email', draft=feedback.draft(row), employer_feedback=''))
            continue
        if stage in ENDED:
            continue
        # Talking or interviewing, but the employer isn't known (an agency's invitation, a hidden client): ask the
        # owner for the details (the app opens its Log box on this job: paste the LinkedIn chat or the job link).
        # Asked until you log something on the job (the Log box): then you've said what you know; what the chat
        # didn't say (a hidden employer, no salary) stays visible on the job, not as a to-do.
        told = any(e['source_id'].startswith('paste:') for e in history)
        missing = [] if told else thin(row)
        # Only once an interview is booked: an agency keeping the employer hidden while you're only talking is normal.
        if stage in ('Interview scheduled', 'Interviewing') and missing:
            coming_at = _when(_field(row, 'Next interview'))
            when = f"Interview {coming_at.astimezone(TZ):%a %d %b, %H:%M}" if coming_at and coming_at > now else stage
            who = _field(row, 'Company') or _field(row, 'Via') or 'a recruiter'
            items.append(_item(1, 'details', '🧩', f"Add details: {who} — {_field(row, 'Job')[:70]}",
                               f"{when}, but Job Pilotto doesn't know the {' or '.join(missing)}. Paste the LinkedIn chat, "
                               "the recruiter's message or the job link: it fills in the job, so your prep and kit fit it.",
                               row, missing=missing))
        last = history[-1] if history else None
        company = _field(row, 'Company') or _field(row, 'Via') or 'A recruiter'
        label = f"{company} — {_field(row, 'Job')[:70]}"
        if last and last['kind'] in NEEDS_ANSWER:
            job_url = _field(row, 'Job URL')
            link = _gmail(last['source_id']) or (job_url if re.search(r'mail\.google\.com|linkedin\.com/messaging', job_url) else '')
            reached = _field(row, 'Reached via') or ('LinkedIn' if 'linkedin' in link else 'Email' if 'mail.google' in link else '')
            where = {'Email': 'by email', 'LinkedIn': 'on LinkedIn', 'Phone': 'by phone'}.get(reached, '')
            when = _ago(last['at'], now) if last['at'] else ''
            if last['kind'] == 'Offer':
                items.append(_item(1, 'offer', '🎉', f'Answer the offer: {label}', f'Offer {when}. {last["note"][:140]}', row,
                                   link, 'Open email' if link else '', done=True))
            elif BOOKING.search(last['note']):
                items.append(_item(1, 'book', '📅', f'Book the call: {label}', f'They asked you to pick a time ({when}). {last["note"][:140]}',
                                   row, link, 'Open email' if 'mail.google' in link else 'Open', done=True))
            else:
                if last['kind'] == 'Recruiter lead':  # the facts that decide the answer, not the event's note
                    facts = ' · '.join(p for p in (_field(row, 'Salary'), _field(row, 'Location'), _field(row, 'Contact').split(' · ')[0]) if p)
                    detail = f'Recruiter pitch {when}{f" ({reached})" if reached else ""}. {facts}'
                else:
                    detail = f'They wrote {when}. {last["note"][:140]}'
                items.append(_item(1, 'reply', '💬', f'Reply {where}: {label}'.replace('Reply : ', 'Reply: '),
                                   detail, row, link,
                                   'Open email' if 'mail.google' in link else 'Open LinkedIn' if 'linkedin' in link else '', done=True,
                                   lead=last['kind'] == 'Recruiter lead'))
            continue
        coming = _when(_field(row, 'Next interview'))
        if coming and coming > now:
            hours = (coming - now).total_seconds() / 3600
            if hours <= 14 * 24:
                items.append(_item(1 if hours <= SOON_HOURS else 2, 'prepare', '🎤', f'Prepare: {label}',
                                   f"Interview {coming.astimezone(TZ):%a %d %b, %H:%M}. Read the posting and your kit, "
                                   'and practise the topics you answered weakly before.', row, at=coming.isoformat()))
                continue
        if coming and now - timedelta(days=3) < coming <= now and interviewed.get(key, '') < coming.astimezone(TZ).date().isoformat():
            items.append(_item(2, 'review', '📝', f'Review the interview: {label}',
                               f"It was {coming.astimezone(TZ):%a %d %b}. Import the recording or transcript (Interviews) "
                               'while you remember it: you get a review of every answer.', row))
            continue
        if stage in ('Screening', 'Interview scheduled') and not (coming and coming > now):
            quiet = (now - last['at']).days if last and last['at'] else QUIET_DAYS
            if quiet >= QUIET_DAYS or stage == 'Interview scheduled':
                items.append(_item(2, 'nudge', '🤝', f'Move it forward: {label}',
                                   f"{stage}, nothing booked{f' and no news for {quiet} days' if quiet >= QUIET_DAYS else ''}. "
                                   'Propose times for the next call, or ask where things stand.', row, quiet=quiet))
    items += questions(rows, events)
    done_today = _applied_today(rows, by_app, today)
    kits = sorted((r for r in rows if _field(r, 'Stage') == 'Kit ready'),
                  key=lambda r: -((r['properties'].get('Fit score') or {}).get('number') or 0))
    left = max(target - done_today, 0)
    if left:
        names = ', '.join(f"{_field(r, 'Company')}" for r in kits[:3])
        items.append(_item(3, 'apply', '📨', f'Apply to {left} more job{"s" if left != 1 else ""} today',
                           f'{done_today} of {target} today.' + (f' {len(kits)} kit{"s" if len(kits) != 1 else ""} ready'
                                                                  f'{f" ({names}…)" if names else ""}.' if kits else
                                                                  ' Prepare kits from your best matches (Jobs).'),
                           applied=done_today, left=left, kits=len(kits), target=target))
    # The latest rejection lesson (last 3 days) is the page's Insight, not a to-do.
    reviewed = [r for r in rows if _field(r, 'Stage') == 'Rejected' and _field(r, 'Rejection lesson')]
    recent = [r for r in reviewed if (_when(r.get('last_edited_time', '')) or now) > now - timedelta(days=3)]
    insight = None
    if recent:
        row = max(recent, key=lambda r: r.get('last_edited_time', ''))
        lesson = _field(row, 'Rejection lesson')
        first = re.split(r'(?<=[.;])\s', lesson, maxsplit=1)[0].rstrip('.;')
        insight = {'reason': _field(row, 'Rejection reason'), 'headline': _short(first, 110),
                   'detail': f"{_field(row, 'Company')} — {_field(row, 'Job')}", 'lesson': lesson,
                   'notion_url': row.get('url', ''), 'page_id': row['id']}
    fresh = [r for r in insights if _field(r, 'Date')[:10] >= (now - timedelta(days=7)).date().isoformat()]
    if fresh:
        row = max(fresh, key=lambda r: (bool(plain(r['properties'].get('Issue detected'))), _field(r, 'Date'), r.get('created_time', '')))
        issue = bool(plain(row['properties'].get('Issue detected')))
        action, evidence = _field(row, 'Action'), _field(row, 'Evidence')
        insight = {'reason': 'Issue detected' if issue else _field(row, 'Category') or 'Insight',
                   'headline': _field(row, 'Insight'), 'detail': action,
                   'lesson': evidence, 'notion_url': row.get('url', ''), 'page_id': row['id'], 'issue': issue, 'report': True}
    waiting = [r for r in rows if _field(r, 'Stage') in ('Applied', 'Confirmation received')
               and (applied := _when(_field(r, 'Applied on'))) and (now - applied).days >= WAITING_DAYS]
    if waiting:
        items.append(_item(4, 'waiting', '⏳', f'{len(waiting)} application{"s" if len(waiting) != 1 else ""} waiting {WAITING_DAYS}+ days',
                           'No human reply yet. For the ones you care most about, message the recruiter or a team member '
                           'on LinkedIn; let the rest go (they close as No response after 21 days).'))
    order = {'offer': 0, 'book': 1, 'which_job': 1.2, 'details': 1.5, 'reply': 2, 'prepare': 3, 'review': 4, 'feedback_review': 5,
             'feedback': 6, 'nudge': 7, 'apply': 8, 'learn': 9, 'feedback_wait': 10, 'waiting': 11}
    items.sort(key=lambda i: (i['priority'], order[i['kind']]))
    items = [present(item) for item in items]
    return {'items': items, 'today': {'applied': done_today, 'target': target, 'kits_ready': len(kits)},
            'insight': insight, 'summary': summary(items), 'funnel': funnel(rows, events),
            'generated_at': now.isoformat(timespec='seconds')}


def funnel(rows, events):
    """The application funnel (src/notion/funnel.py) from the rows already read: each step, how many reached it,
    their share of applications, and the step to improve (with its advice) when there's enough data."""
    kinds = {}
    for event in events:
        kind = plain(event['properties'].get('Kind'))
        for link in (event['properties'].get('Application') or {}).get('relation', []):
            kinds.setdefault(link['id'].replace('-', ''), set()).add(kind)
    apps = [{'stage': _field(r, 'Stage'), 'seen': kinds.get(r['id'].replace('-', ''), set()) | {_field(r, 'Stage')},
             'url': _field(r, 'Job URL')}
            for r in rows if _field(r, 'Stage') in OUTCOME_STAGES + funnel_steps.PREPARED_STAGES]
    steps = funnel_steps.funnel(apps)
    weak = funnel_steps.focus(steps)
    page = funnel_steps.PIPELINE_PAGE_ID
    # now: still at this step (reached it, not the next one, not closed): the number the Jobs boxes show.
    # urls: every application that ever reached each step (the count only grows), for the Jobs list a click shows.
    here = [[a['url'] for a in apps if a['url'] and (marks is None or a['seen'] & marks)] for _, marks, _, _ in funnel_steps.STEPS]
    return {'steps': [{'step': s['step'], 'reached': s['reached'], 'now': s['waiting'], 'of_applied': s.get('of_applied'), 'urls': urls}
                      for s, urls in zip(steps, here)],
            'improve': {'step': weak['step'], 'advice': weak['advice']} if weak else None,
            'notion_url': f'https://www.notion.so/{page.replace("-", "")}' if page else ''}


def settings_target():
    """The daily target from ⚙️ Search settings ("Daily applications target"), read from Notion first."""
    from .notion import search_settings
    search_settings.sync_quietly()
    try:
        return max(int(search_settings.load_cached()['preferences'].get('daily_applications_target') or DEFAULT_TARGET), 1)
    except (TypeError, ValueError):
        return DEFAULT_TARGET


def load(tracker, *, target=None, now=None):
    """Applications, events, interviews and (without a target given) the Search settings target, read at once."""
    rows, events, interviews, target, insights = notion.together(
        lambda: tracker.query_database(tracker.database_id),
        lambda: tracker.query_database(EVENTS_DATABASE_ID) if EVENTS_DATABASE_ID else [],
        lambda: tracker.query_database(INTERVIEWS_DATABASE_ID) if INTERVIEWS_DATABASE_ID else [],
        lambda: target or settings_target(),
        lambda: tracker.query_database(INSIGHTS_DATABASE_ID) if INSIGHTS_DATABASE_ID else [])
    return build(rows, events, interviews, target=target, now=now, insights=insights)


def reminder(focus, now=None):
    """One reminder text, or '' when there's nothing worth interrupting for."""
    now = now or datetime.now(timezone.utc)
    today, items = focus['today'], focus['items']
    waiting = [i for i in items if i['kind'] in ('offer', 'book', 'reply')]
    soon = [i for i in items if i['kind'] == 'prepare' and i['priority'] == 1]
    # Behind the target: fewer than the share of the day that has passed (from 8:00 to 20:00).
    hour = now.astimezone(TZ).hour + now.astimezone(TZ).minute / 60
    expected = today['target'] * min(max((hour - 8) / 12, 0), 1)
    behind = today['applied'] < expected
    parts = []
    if waiting:
        parts.append(f"💬 {len(waiting)} {'person waits' if len(waiting) == 1 else 'people wait'} for your answer: "
                     + ', '.join(i['company'] or 'a recruiter' for i in waiting[:3]))
    if soon:
        parts.append('🎤 Interview soon: ' + ', '.join(i['company'] for i in soon[:2]))
    learning = [i for i in items if i['kind'] in ('feedback', 'feedback_review')]
    if learning:
        parts.append(f"💬 {len(learning)} feedback action(s): " + ', '.join(i['company'] for i in learning[:3])
                     + ' — one useful point can improve your next interview')
    if behind:
        parts.append(f"📨 {today['applied']}/{today['target']} applications today"
                     + (f"; {today['kits_ready']} kits ready" if today['kits_ready'] else ''))
    return '\n'.join(parts)


# ---- history: what you resolved from Focus (Notion keeps it: 📈 Application Events from the app, and 💡 Insights you rated)
HISTORY_TITLES = {
    'Replied': ('💬', 'Replied to {company}'),
    'Feedback requested': ('🙋', 'Asked {company} for feedback'),
    'Feedback received': ('📥', 'Got feedback from {company}'),
    'Feedback reviewed': ('📝', "Reviewed {company}'s feedback"),
    'Feedback skipped': ('⏭️', 'Skipped asking {company} for feedback'),
}


def history(tracker, days=90):
    """Newest first: [{at, kind, emoji, title, note, url}] for the last `days` days."""
    since = (date.today() - timedelta(days=days)).isoformat()
    items = []
    if EVENTS_DATABASE_ID:
        rows = tracker.query_database(EVENTS_DATABASE_ID, {'and': [
            {'property': 'At', 'date': {'on_or_after': since}},
            {'property': 'Source', 'select': {'equals': 'Job Pilotto app'}}]})
        for row in rows:
            props = row['properties']
            kind = plain(props.get('Kind')) or ''
            company = (plain(props.get('Event')) or '').split(' · ', 1)[-1] or 'an employer'
            emoji, title = HISTORY_TITLES.get(kind, ('✓', f'{kind} · {{company}}'))
            items.append({'at': plain(props.get('At')) or '', 'kind': kind, 'emoji': emoji, 'title': title.format(company=company),
                          'note': (plain(props.get('Note')) or '')[:240], 'url': row.get('url', '')})
    from .ai.insights import INSIGHTS_DATABASE_ID
    if INSIGHTS_DATABASE_ID:
        rows = tracker.query_database(INSIGHTS_DATABASE_ID, {'property': 'Date', 'date': {'on_or_after': since}})
        for row in rows:
            props = row['properties']
            rated = plain(props.get('Feedback'))
            if not rated:
                continue
            items.append({'at': plain(props.get('Date')) or '', 'kind': 'insight', 'emoji': '💡', 'title': f'Insight: {rated}',
                          'note': (plain(props.get('Insight')) or '')[:240], 'url': row.get('url', '')})
    return sorted(items, key=lambda item: item['at'], reverse=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', nargs='?', default='list', choices=('list', 'done', 'remind', 'history'))
    parser.add_argument('page_id', nargs='?')
    parser.add_argument('what', nargs='?', default='replied')
    parser.add_argument('--target', type=int, help='default: "Daily applications target" on ⚙️ Search settings')
    parser.add_argument('--send', action='store_true', help='remind: also send it to Telegram')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required')
    if args.command == 'history':
        print(json.dumps({'items': history(tracker)}, ensure_ascii=False))
        return 0
    if args.command == 'done':
        if not args.page_id:
            raise SystemExit('done needs the application page id')
        row = tracker._request('GET', f'pages/{args.page_id}')
        add_event(tracker, row, REPLIED, 'Job Pilotto app', note='You answered (marked done in Focus)')
        print(json.dumps({'ok': True}))
        return 0
    focus = load(tracker, target=args.target)
    if args.command == 'remind':
        text = reminder(focus)
        if text and args.send:
            from .features import disabled
            if not disabled('telegram'):
                token, chat_id = telegram.credentials()
                if token and chat_id:
                    telegram.send('🧭 <b>Focus</b>\n' + escape(text), token, chat_id)
        print(json.dumps({'text': text}))
        return 0
    print(json.dumps(focus, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
