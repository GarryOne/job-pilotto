#!/usr/bin/env python3
"""Gmail + Calendar -> the application ledger, read-only.

Each run (3 times a day by default, and 5 minutes after an application is marked Applied):

1. **Gmail**: searches recent mail from applicant-tracking systems, recruiter platforms and booking
   tools, plus mail naming a tracked company or role. Claude Haiku 4.5 classifies each new email
   (confirmation, reply, interview scheduled, rejection, offer, or not about an application) and
   matches it to an application. Matches become 📈 Application Events at the email's own time
   (Source Gmail, Source ID = message id, so an email is never logged twice), move Stage forward
   (never back), and fill Next interview when a time is stated. An event logged by hand for the same
   application, kind and day is linked to the email instead of duplicated.
2. **Calendar**: upcoming events that belong to an application (company, platform, or a contact's
   email among the attendees) set Next interview and an Interview scheduled event. The evening
   before (and the morning of) an interview, Telegram gets a prep message; a few hours after it,
   a nudge to send the transcript for an interview review.

A Telegram summary lists what changed. Nothing in Gmail or Calendar is modified.

Usage:
  python -m src.ai.mail [--days 2] [--send] [--dry-run] [--no-calendar]
"""
import argparse
from datetime import datetime, timedelta, timezone
from html import escape
import json
import os
import re
import sys
from zoneinfo import ZoneInfo

from .. import telegram
from ..notion import client as notion
from ..notion.ledger import EVENTS_DATABASE_ID, OUTCOME_STAGES, REPLY, add_event, plain
from ..paths import DATA
from ..sources.google import Google
from . import cost

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_MAIL_MODEL', 'claude-haiku-4-5')
TZ = ZoneInfo(os.getenv('JOB_PILOTTO_TZ', 'Europe/Zurich'))
STATE_FILE = DATA / 'mail-state.json'
# Senders that only write about applications: ATSs, recruiter platforms, schedulers.
SENDER_DOMAINS = ('greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com',
                  'myworkday.com', 'myworkdayjobs.com', 'personio.de', 'personio.com', 'recruitee.com', 'teamtailor.com',
                  'join.com', 'bamboohr.com', 'jobvite.com', 'icims.com', 'techtree.dev', 'cal.com', 'calendly.com',
                  'goodtime.io', 'devskiller.com', 'thomas.co', 'hackerrank.com', 'codility.com', 'coderpad.io')
SUBJECT_WORDS = ('application', 'applying', 'applied', 'interview', 'candidacy', 'your candidature', 'next steps',
                 'screening', 'offer')
KINDS = ['Confirmation received', REPLY, 'Interview scheduled', 'Rejected', 'Offer', 'Other']
# Stage order for "forward only": an email never moves an application back.
RANK = {stage: i for i, stage in enumerate(('Applied', 'No response', 'Confirmation received', 'Screening',
                                            'Interview scheduled', 'Interviewing', 'Offer'))}
TERMINAL = {'Rejected', 'Withdrawn', 'Offer'}
BATCH = 8
INTERVIEWISH = re.compile(r'interview|screening|recruit|hiring|technical|intro(duction)? call|call with|onsite|panel', re.I)

SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['results'],
    'properties': {'results': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False,
        'required': ['index', 'relevant', 'application', 'company', 'kind', 'interview_at', 'summary'],
        'properties': {
            'index': {'type': 'integer'},
            'relevant': {'type': 'boolean', 'description': "About one of the owner's own job applications"},
            'application': {'type': 'integer', 'description': 'Index in the applications list, or -1'},
            'company': {'type': 'string', 'description': 'Hiring company (or platform) named in the item'},
            'kind': {'type': 'string', 'enum': KINDS},
            'interview_at': {'type': 'string', 'description': 'ISO 8601 start of a scheduled call/interview with UTC offset, else ""'},
            'summary': {'type': 'string', 'description': 'What happened, max 120 characters, no personal data'},
        }}}},
}

SYSTEM = """You sort the job-search emails (and calendar events) of the owner of Job Pilotto. For each item:
- relevant: true only when it is about one of the owner's own applications or hiring processes. Job alerts, \
newsletters, marketing, "jobs you may like" and other people's mail are not relevant.
- application: the index of the matching application from the list, or -1 if none fits. When the owner applied \
to several roles at one company, pick the one whose title the item names; if it names none, pick -1 unless only \
one role at that company is open. Recruiter platforms (e.g. TechTree) may hide the employer: match on the \
platform ("Via") and role title.
- kind: "Confirmation received" = automatic acknowledgement that the application arrived. "Reply received" = a \
person or process answered without a time being fixed yet: an invitation to book or pick a slot, an assessment \
or test link, a recruiter's message. "Interview scheduled" = a specific call or interview was booked for a stated \
time (the booking confirmation or calendar invite itself). "Rejected" = not moving forward. "Offer" = an offer. \
"Other" = relevant but none of these: reminders or "starting soon" notices for a call already booked, "still open" \
nudges, transcripts or recordings of a call, security codes, logistics.
- interview_at: only when a specific time is stated; ISO 8601 with offset (assume Europe/Zurich if none is given).
- summary: factual, short, no email addresses or phone numbers.
Answer for every item index."""


def load_state(path=STATE_FILE):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {'seen': [], 'notified': []}


def save_state(state, path=STATE_FILE):
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {'seen': state['seen'][-3000:], 'notified': state['notified'][-1000:]}
    path.write_text(json.dumps(state))


def applications(tracker):
    """Applications that emails and events can belong to, oldest first (stable indexes)."""
    rows = tracker.query_database(tracker.database_id, {'or': [
        {'property': 'Stage', 'select': {'equals': stage}} for stage in OUTCOME_STAGES]})
    return sorted(rows, key=lambda r: (plain(r['properties'].get('Applied on')) or '', r['id']))


def _field(row, name):
    return plain(row['properties'].get(name)) or ''


def query(apps, days):
    """One Gmail search: known senders, application-ish subjects, or a tracked company's name."""
    names = {n for r in apps for n in (_field(r, 'Company'), _field(r, 'Via')) if n and len(n) > 2 and len(n) < 40}
    terms = [f'from:{d}' for d in SENDER_DOMAINS] + [f'subject:"{w}"' for w in SUBJECT_WORDS] + [f'"{n}"' for n in sorted(names)]
    return f'newer_than:{days}d -in:chats -in:spam -in:trash {{{" ".join(terms)}}}'


def listing(apps):
    return '\n'.join(f"{i}. {_field(r, 'Company')} — {_field(r, 'Job')} (stage {_field(r, 'Stage')}"
                     f"{', via ' + _field(r, 'Via') if _field(r, 'Via') else ''}, applied {_field(r, 'Applied on') or '?'})"
                     for i, r in enumerate(apps))


def classify(client, model, apps, items, stats=None):
    """Haiku results for items (dicts with from, subject, date, body), in batches; index -> result."""
    results = {}
    for start in range(0, len(items), BATCH):
        chunk = items[start:start + BATCH]
        text = '\n\n'.join(f"### Item {start + i}\nFrom: {m['from']}\nDate: {m['date']}\nSubject: {m['subject']}\n\n{m['body'][:3000]}"
                           for i, m in enumerate(chunk))
        response = client.messages.create(
            model=model, max_tokens=4000,
            system=[{'type': 'text', 'text': SYSTEM + '\n\nApplications:\n' + (listing(apps) or '(none)'),
                     'cache_control': {'type': 'ephemeral'}}],
            messages=[{'role': 'user', 'content': text}],
            output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}},
        )
        cost.add(stats, model, response.usage)
        for result in json.loads(next(b.text for b in response.content if b.type == 'text'))['results']:
            results[result['index']] = result
    return results


def _when(value):
    try:
        moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (AttributeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=TZ)


def _events_index(tracker):
    """Known Source IDs, and per application page id: [(kind, at, event page id, source id)]."""
    known, by_app = set(), {}
    for event in tracker.query_database(EVENTS_DATABASE_ID):
        props = event['properties']
        source_id = plain(props.get('Source ID')) or ''
        if source_id:
            known.add(source_id)
        for link in (props.get('Application') or {}).get('relation', []):
            by_app.setdefault(link['id'].replace('-', ''), []).append(
                (plain(props.get('Kind')), plain(props.get('At')) or '', event['id'], source_id))
    return known, by_app


def _near(existing, kind, at, hours=24):
    """An event of this kind within `hours` of `at` (and without a source id yet), or None."""
    moment = _when(at)
    for event_kind, event_at, event_id, source_id in existing:
        other = _when(event_at if 'T' in event_at else event_at + 'T12:00:00')
        if event_kind == kind and moment and other and abs((moment - other).total_seconds()) < hours * 3600:
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


def record(tracker, row, kind, at, source, source_id, note, index, interview_at=None, now=None):
    """Write one matched item: event (or link to a hand-logged twin), Stage forward, Next interview.
    Returns a short description of what changed, or None when it was already known."""
    key = row['id'].replace('-', '')
    known, by_app = index
    if source_id in known:
        return None
    twin = _near(by_app.get(key, []), kind, at)
    if twin and not twin[1]:
        # Hand-logged events carry estimated times; the email's (or booking's) own timestamp is exact.
        tracker.update_page(twin[0], {'Source ID': {'rich_text': [{'text': {'content': source_id}}]},
                                      'At': {'date': {'start': at}}})
        known.add(source_id)
        return None
    if twin:
        return None
    event = add_event(tracker, row, kind, source, at=at, note=note)
    tracker.update_page(event['id'], {'Source ID': {'rich_text': [{'text': {'content': source_id}}]}})
    known.add(source_id)
    by_app.setdefault(key, []).append((kind, at, event['id'], source_id))
    changes = {}
    stage = _stage_for(kind, _field(row, 'Stage'))
    if stage:
        changes['Stage'] = {'select': {'name': stage}}
    moment, current = _when(interview_at or ''), _when(_field(row, 'Next interview'))
    now = now or datetime.now(timezone.utc)
    if moment and moment > now and (not current or current < now or moment < current):
        changes['Next interview'] = {'date': {'start': moment.isoformat()}}
    if kind == 'Confirmation received':
        changes['Confirmation email'] = {'checkbox': True}
    if changes:
        tracker.update_page(row['id'], changes)
    return stage or kind


EMOJI = {'Confirmation received': '📬', REPLY: '💬', 'Interview scheduled': '🗓', 'Rejected': '❌', 'Offer': '🎉', 'Other': '•'}


def _label(row):
    return f"{escape(_field(row, 'Company'))} — {escape(_field(row, 'Job'))[:60]}"


def mail_pass(tracker, google, client, model, apps, index, state, days, stats, dry_run=False, now=None):
    """Process new emails; returns (lines for Telegram, count classified)."""
    seen = set(state['seen'])
    ids = [i for i in google.search(query(apps, days), limit=60) if i not in seen and i not in index[0]]
    emails = sorted((google.message(i) for i in ids), key=lambda m: m['date'])
    if not emails:
        return [], 0
    results = classify(client, model, apps, emails, stats)
    lines = []
    for i, email in enumerate(emails):
        result = results.get(i) or {'relevant': False}
        row = apps[result['application']] if result.get('relevant') and 0 <= result.get('application', -1) < len(apps) else None
        if result.get('relevant') and not row:  # e.g. a scheduler email naming only the recruiter
            row = _by_mention(apps, f"{email['from']} {email['subject']} {email['body'][:1500]}")
        if dry_run:
            print(f"{email['date'][:16]} {email['subject'][:60]!r}: {result}")
            continue
        state['seen'].append(email['id'])
        if row and result.get('relevant') and re.search(r'transcript|recording', email['subject'], re.I):
            lines.append(f"📝 {_label(row)}: {escape(email['subject'][:90])} — download it and send it to me "
                         "for an interview review.")
        if not result.get('relevant') or result.get('kind') == 'Other':
            continue
        if not row and not _about_tracked(apps, f"{result['company']} {email['from']} {email['subject']}"):
            lines.append(f"📧 {escape(result['company'] or email['subject'][:60])}: {escape(result['summary'])}"
                         " — not tracked yet; /add its job URL to follow it.")
            continue
        if not row:
            continue  # about a tracked process but not matched to one role: nothing reliable to log
        changed = record(tracker, row, result['kind'], email['date'], 'Gmail', email['id'],
                         f"{result['summary']} (email: \"{email['subject'][:120]}\")", index, result['interview_at'], now)
        if changed:
            when = _when(result['interview_at'] or '')
            extra = f" · {when.astimezone(TZ):%a %d %b %H:%M}" if when else ''
            lines.append(f"{EMOJI.get(result['kind'], '•')} {_label(row)}: {escape(result['summary'])}{extra}")
    return lines, len(emails)


def _contact_names(row):
    """Full names written in the Contact field ("Alex Morgan · alex@yupe.io" -> "alex morgan")."""
    return {m.lower() for m in re.findall(r"\b[A-Z][a-zà-ÿ'-]+ [A-Z][a-zà-ÿ'-]+\b", _field(row, 'Contact'))}


def _matches(row, text):
    """True if the text names this application's company, platform, a contact's name or email."""
    text = text.lower()
    names = [n.lower() for n in (_field(row, 'Company'), _field(row, 'Via')) if len(n) > 2]
    names += [n.split()[0].lower() for n in names if len(n.split()[0]) >= 5]
    names += sorted(_contact_names(row))
    emails = re.findall(r'[\w.+-]+@[\w-]+\.[\w.-]+', _field(row, 'Contact').lower())
    return any(re.search(rf'(?<![\w]){re.escape(n)}(?![\w])', text) for n in names) or any(e in text for e in emails)


def _by_mention(apps, text):
    """The single application this text names (company, platform or contact), or None."""
    found = [row for row in apps if _matches(row, text)]
    return found[0] if len(found) == 1 else None


def _about_tracked(apps, text):
    """True if the text names a tracked company, platform, contact, or a contact's email domain: then an
    unmatched email isn't a new, untracked application."""
    if any(_matches(row, text) for row in apps):
        return True
    domains = {d.split('.')[0] for row in apps for d in re.findall(r'@([\w-]+\.[\w.-]+)', _field(row, 'Contact').lower())}
    return any(d and d in text.lower() for d in domains)


def _event_text(event):
    people = [f"{a.get('displayName', '')} {a.get('email', '')}" for a in event.get('attendees', [])]
    organizer = event.get('organizer') or {}
    return ' '.join([event.get('summary', ''), event.get('description', ''), event.get('location', ''),
                     organizer.get('email', ''), organizer.get('displayName', ''), *people])


def calendar_pass(tracker, google, client, model, apps, index, state, stats, now=None, dry_run=False):
    """Match calendar events to applications; returns (lines, reminders) for Telegram."""
    now = now or datetime.now(timezone.utc)
    events = [e for e in google.events(now - timedelta(days=1), now + timedelta(days=21))
              if e.get('status') != 'cancelled' and (e.get('start') or {}).get('dateTime')]
    matched, unmatched = [], []
    for event in events:
        rows = [r for r in apps if _matches(r, _event_text(event))]
        if len(rows) == 1:
            matched.append((event, rows[0]))
        elif INTERVIEWISH.search(event.get('summary', '')):
            unmatched.append(event)
    if unmatched:
        items = [{'from': (e.get('organizer') or {}).get('email', ''), 'subject': e.get('summary', ''),
                  'date': e['start']['dateTime'], 'body': _event_text(e)} for e in unmatched]
        for i, result in classify(client, model, apps, items, stats).items():
            if result['relevant'] and 0 <= result['application'] < len(apps):
                matched.append((unmatched[i], apps[result['application']]))
    lines, notes = [], []
    for event, row in matched:
        start, end = _when(event['start']['dateTime']), _when(event['end']['dateTime'])
        if dry_run:
            print(f"{start:%Y-%m-%d %H:%M} {event.get('summary', '')!r} -> {_field(row, 'Company')}")
            continue
        if start > now:
            changed = record(tracker, row, 'Interview scheduled', event.get('created') or now.isoformat(), 'Calendar',
                             f"cal:{event['id']}", f"Calendar: {event.get('summary', '')[:150]} at {start.astimezone(TZ):%a %d %b %H:%M}",
                             index, start.isoformat(), now)
            if changed:
                lines.append(f"🗓 {_label(row)}: {escape(event.get('summary', ''))[:80]} · {start.astimezone(TZ):%a %d %b %H:%M}")
        notes += reminders(tracker, row, event, start, end, state, now)
    return lines, notes


def reminders(tracker, row, event, start, end, state, now):
    """Prep message the evening before / the morning of, and a nudge for the transcript after."""
    local, messages = now.astimezone(TZ), []
    key_before, key_after = f"prep:{event['id']}", f"after:{event['id']}"
    tomorrow = start.astimezone(TZ).date() == (local + timedelta(days=1)).date() and local.hour >= 17
    today = start.astimezone(TZ).date() == local.date() and start > now
    if (tomorrow or today) and key_before not in state['notified']:
        state['notified'].append(key_before)
        messages.append(prep_message(tracker, row, event, start, 'Tomorrow' if tomorrow else 'Today'))
    if end < now < end + timedelta(hours=18) and 8 <= local.hour <= 22 and key_after not in state['notified']:
        state['notified'].append(key_after)
        messages.append(f"🎤 How did <b>{_label(row)}</b> go? Send the transcript (or /interview with your notes) "
                        f"with the caption \"{escape(_field(row, 'Company'))}, {escape(event.get('summary', 'interview'))[:40]}\" "
                        "for a review.")
    return messages


def prep_message(tracker, row, event, start, day):
    from . import interviews  # local import: interviews imports the ledger too
    lines = [f"🗓 <b>{day} {start.astimezone(TZ):%H:%M} — {_label(row)}</b>", escape(event.get('summary', ''))]
    link = event.get('hangoutLink') or event.get('location') or ''
    if link:
        lines.append(escape(link))
    people = [a.get('displayName') or a.get('email', '') for a in event.get('attendees', []) if not a.get('self')]
    if people:
        lines.append('With: ' + escape(', '.join(people[:5])))
    stats = interviews.stats_for_insights(tracker)
    weak = list(stats['topics_answered_weakly'])[:3]
    if weak:
        lines += ['', '🏋️ <b>Answered weakly in past interviews</b>'] + [f'• {escape(t)}' for t in weak]
    if _field(row, 'Next step'):
        lines += ['', f"📝 {escape(_field(row, 'Next step'))[:300]}"]
    lines += ['', 'Recording? Ask everyone for consent at the start.', f"<a href=\"{escape(row.get('url', ''), quote=True)}\">Application in Notion</a>"]
    return '\n'.join(lines)


def run(tracker, google, *, client=None, model=DEFAULT_MODEL, days=2, send=None, calendar=True, dry_run=False,
        now=None, state_path=STATE_FILE, stats=None):
    state = load_state(state_path)
    apps = applications(tracker)
    index = _events_index(tracker)
    if client is None:
        import anthropic
        client = anthropic.Anthropic()
    lines, count = mail_pass(tracker, google, client, model, apps, index, state, days, stats, dry_run, now)
    notes = []
    if calendar:
        cal_lines, notes = calendar_pass(tracker, google, client, model, apps, index, state, stats, now, dry_run)
        lines += cal_lines
    if not dry_run:
        save_state(state, state_path)
    if send and lines:
        send('📧 <b>Job emails and calendar</b>\n' + '\n'.join(lines))
    for note in notes:
        if send:
            send(note)
    usd = (stats or {}).get('usd', 0.0)
    return f'Mail: {count} new email(s) classified, {len(lines)} update(s), {len(notes)} reminder(s) (${usd:.3f})'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--days', type=int, default=2, help='how far back to search Gmail')
    parser.add_argument('--send', action='store_true', help='send the summary and reminders to Telegram')
    parser.add_argument('--dry-run', action='store_true', help='classify and print; write nothing')
    parser.add_argument('--no-calendar', action='store_true')
    args = parser.parse_args(argv)
    tracker, google = notion.Tracker.from_env(), Google.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required')
    if not google:
        print('Google is not connected (GOOGLE_* secrets / Keychain); nothing to do. See README → Gmail and Calendar.')
        return 0
    sender = None
    if args.send:
        token, chat_id = telegram.credentials()
        sender = lambda text: telegram.send(text, token, chat_id)
    stats = {}
    print(run(tracker, google, days=args.days, send=sender, calendar=not args.no_calendar, dry_run=args.dry_run, stats=stats))
    return 0


if __name__ == '__main__':
    sys.exit(main())
