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
  python -m src.focus [--target 30]            # the list as JSON (for the app)
  python -m src.focus done <page id> replied   # you answered: log it
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
from .notion import client as notion
from .notion.ledger import EVENTS_DATABASE_ID, REPLY, add_event, plain

TZ = ZoneInfo(os.getenv('JOB_PILOTTO_TZ', 'Europe/Zurich'))
INTERVIEWS_DATABASE_ID = os.getenv('NOTION_INTERVIEWS_DB', '')
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


def _item(priority, kind, emoji, title, detail, row=None, link='', link_label='', done=False):
    return {'priority': priority, 'kind': kind, 'emoji': emoji, 'title': title, 'detail': detail,
            'company': _field(row, 'Company') if row else '', 'job': _field(row, 'Job') if row else '',
            'job_url': _field(row, 'Job URL') if row else '', 'page_id': row['id'] if row else '',
            'notion_url': (row or {}).get('url', ''), 'link': link, 'link_label': link_label, 'done': done}


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


def build(rows, events, interviews=(), *, target=DEFAULT_TARGET, now=None):
    """{'items': [...], 'today': {...}}: the focus list, most important first. Pure: no I/O."""
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(TZ).date()
    by_app, interviewed, items = _events_by_app(events), _interviewed(interviews), []
    for row in rows:
        stage, key = _field(row, 'Stage'), row['id'].replace('-', '')
        if stage in ENDED:
            continue
        history = by_app.get(key, [])
        last = history[-1] if history else None
        company = _field(row, 'Company') or _field(row, 'Via') or 'A recruiter'
        label = f"{company} — {_field(row, 'Job')[:70]}"
        if last and last['kind'] in NEEDS_ANSWER:
            link = _gmail(last['source_id']) or (_field(row, 'Job URL') if 'linkedin.com/messaging' in _field(row, 'Job URL') else '')
            where = 'on LinkedIn' if 'linkedin' in link else 'by email' if link else ''
            when = _ago(last['at'], now) if last['at'] else ''
            if last['kind'] == 'Offer':
                items.append(_item(1, 'offer', '🎉', f'Answer the offer: {label}', f'Offer {when}. {last["note"][:140]}', row,
                                   link, 'Open the email' if link else '', done=True))
            elif BOOKING.search(last['note']):
                items.append(_item(1, 'book', '📅', f'Book the call: {label}', f'They asked you to pick a time ({when}). {last["note"][:140]}',
                                   row, link, 'Open the email' if 'mail.google' in link else 'Open', done=True))
            else:
                what = 'Recruiter pitch' if last['kind'] == 'Recruiter lead' else 'They wrote'
                items.append(_item(1, 'reply', '💬', f'Reply {where}: {label}'.replace('Reply : ', 'Reply: '),
                                   f'{what} {when}. {last["note"][:140]}', row, link,
                                   'Open the email' if 'mail.google' in link else 'Open on LinkedIn' if 'linkedin' in link else '', done=True))
            continue
        coming = _when(_field(row, 'Next interview'))
        if coming and coming > now:
            hours = (coming - now).total_seconds() / 3600
            if hours <= 14 * 24:
                items.append(_item(1 if hours <= SOON_HOURS else 2, 'prepare', '🎤', f'Prepare: {label}',
                                   f"Interview {coming.astimezone(TZ):%a %d %b, %H:%M}. Read the posting and your kit, "
                                   'and practise the topics you answered weakly before.', row))
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
                                   'Propose times for the next call, or ask where things stand.', row))
    done_today = _applied_today(rows, by_app, today)
    kits = sorted((r for r in rows if _field(r, 'Stage') == 'Kit ready'),
                  key=lambda r: -((r['properties'].get('Fit score') or {}).get('number') or 0))
    left = max(target - done_today, 0)
    if left:
        names = ', '.join(f"{_field(r, 'Company')}" for r in kits[:3])
        items.append(_item(3, 'apply', '📨', f'Apply to {left} more job{"s" if left != 1 else ""} today',
                           f'{done_today} of {target} today.' + (f' {len(kits)} kit{"s" if len(kits) != 1 else ""} ready'
                                                                  f'{f" ({names}…)" if names else ""}.' if kits else
                                                                  ' Prepare kits from your best matches (Jobs).')))
    reviewed = [r for r in rows if _field(r, 'Stage') == 'Rejected' and _field(r, 'Rejection lesson')]
    recent = [r for r in reviewed if (_when(r.get('last_edited_time', '')) or now) > now - timedelta(days=3)]
    if recent:
        row = max(recent, key=lambda r: r.get('last_edited_time', ''))
        items.append(_item(4, 'learn', '🔎', f"Learn from the rejection: {_field(row, 'Company')} — {_field(row, 'Job')[:60]}",
                           f"{_field(row, 'Rejection reason')}. {_field(row, 'Rejection lesson')[:220]}", row))
    waiting = [r for r in rows if _field(r, 'Stage') in ('Applied', 'Confirmation received')
               and (applied := _when(_field(r, 'Applied on'))) and (now - applied).days >= WAITING_DAYS]
    if waiting:
        items.append(_item(4, 'waiting', '⏳', f'{len(waiting)} application{"s" if len(waiting) != 1 else ""} waiting {WAITING_DAYS}+ days',
                           'No human reply yet. For the ones you care most about, message the recruiter or a team member '
                           'on LinkedIn; let the rest go (they close as No response after 21 days).'))
    order = {'offer': 0, 'book': 1, 'reply': 2, 'prepare': 3, 'review': 4, 'nudge': 5, 'apply': 6, 'learn': 7, 'waiting': 8}
    items.sort(key=lambda i: (i['priority'], order[i['kind']]))
    return {'items': items, 'today': {'applied': done_today, 'target': target, 'kits_ready': len(kits)},
            'generated_at': now.isoformat(timespec='seconds')}


def load(tracker, *, target=DEFAULT_TARGET, now=None):
    rows = tracker.query_database(tracker.database_id)
    events = tracker.query_database(EVENTS_DATABASE_ID) if EVENTS_DATABASE_ID else []
    interviews = tracker.query_database(INTERVIEWS_DATABASE_ID) if INTERVIEWS_DATABASE_ID else []
    return build(rows, events, interviews, target=target, now=now)


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
    if behind:
        parts.append(f"📨 {today['applied']}/{today['target']} applications today"
                     + (f"; {today['kits_ready']} kits ready" if today['kits_ready'] else ''))
    return '\n'.join(parts)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', nargs='?', default='list', choices=('list', 'done', 'remind'))
    parser.add_argument('page_id', nargs='?')
    parser.add_argument('what', nargs='?', default='replied')
    parser.add_argument('--target', type=int, default=DEFAULT_TARGET)
    parser.add_argument('--send', action='store_true', help='remind: also send it to Telegram')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required')
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
