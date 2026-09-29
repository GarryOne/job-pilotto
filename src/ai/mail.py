#!/usr/bin/env python3
"""Gmail + Calendar -> the application ledger, read-only.

Each run (3 times a day by default, and 5 minutes after an application is marked Applied):

1. **Gmail**: searches recent mail from applicant-tracking systems, recruiter platforms and booking
   tools, plus mail naming a tracked company or role. Claude Haiku 4.5 classifies each new email
   (confirmation, reply, interview scheduled, rejection, offer, or not about an application) and
   matches it to an application. A recruiter pitching a new role ("Recruiter outreach") becomes a tracked
   recruiter lead (src/ai/opportunity.py: Applications row at Stage Recruiter lead, the message in its page,
   a Telegram line); their follow-ups then match it like any application. Matches become 📈 Application Events at the email's own time
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
import urllib.error
from zoneinfo import ZoneInfo

from .. import telegram
from ..notion import client as notion, cron_runs
from ..notion.ledger import EVENTS_DATABASE_ID, OUTCOME_STAGES, REPLY, add_event, plain
from ..paths import DATA
from ..sources.google import Google
from . import cost, opportunity
from .. import feedback as employer_feedback

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_MAIL_MODEL', 'claude-haiku-4-5')
TZ = ZoneInfo(os.getenv('JOB_PILOTTO_TZ', 'Europe/Zurich'))
STATE_FILE = DATA / 'mail-state.json'
# Senders that only write about applications: ATSs, recruiter platforms, schedulers.
SENDER_DOMAINS = ('greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com',
                  'myworkday.com', 'myworkdayjobs.com', 'personio.de', 'personio.com', 'recruitee.com', 'teamtailor.com',
                  'join.com', 'bamboohr.com', 'jobvite.com', 'icims.com', 'techtree.dev', 'cal.com', 'calendly.com',
                  'goodtime.io', 'devskiller.com', 'thomas.co', 'hackerrank.com', 'codility.com', 'coderpad.io')
# Recruitment agencies: their emails name the candidate and a short role ("Connect Igor / Jaya - SRE"), rarely a
# subject word below, and the employer is often hidden, so no tracked company matches either.
RECRUITER_DOMAINS = ('huxley.com', 'hays.com', 'hays.ch', 'hays.de', 'michaelpage.com', 'michaelpage.ch', 'pagegroup.com',
                     'robertwalters.com', 'robertwalters.ch', 'randstad.com', 'randstad.ch', 'adecco.com', 'adecco.ch',
                     'experis.com', 'experis.ch', 'harveynash.com', 'akkodis.com', 'modis.com', 'computerfutures.com',
                     'frankgroup.com', 'jeffersonfrank.com', 'nigelfrank.com', 'masonfrank.com', 'sthree.com',
                     'progressive.com', 'oliverjames.com', 'harnham.com', 'wearehirehive.com', 'kforce.com', 'kellyservices.ch')
# Emailed calendar invitations carry an invite.ics: an interview booked by someone the check doesn't know yet.
INVITES = 'filename:invite.ics'
# Short forms of the user's role words, as recruiters write them in subjects.
ROLE_SHORT = {'site reliability': 'SRE', 'devops': 'DevOps', 'platform engineer': 'Platform', 'kubernetes': 'Kubernetes'}
SUBJECT_WORDS = ('application', 'applying', 'applied', 'interview', 'candidacy', 'your candidature', 'next steps',
                 'screening', 'offer', 'opportunity', 'role', 'position', 'hiring', 'feedback')
# LinkedIn's own notification emails for a new message or InMail (the owner's mail, not LinkedIn scraping).
LINKEDIN_SENDERS = ('messages-noreply@linkedin.com', 'inmail-hit-reply@linkedin.com')
OUTREACH = 'Recruiter outreach'
YOU_REPLIED = 'Replied'  # the event Focus's Done writes when you answered (src/focus.py REPLIED)
KINDS = ['Confirmation received', REPLY, 'Interview scheduled', 'Rejected', 'Offer', OUTREACH, 'Other', employer_feedback.RECEIVED]
# Stage order for "forward only": an email never moves an application back.
RANK = {stage: i for i, stage in enumerate((opportunity.LEAD_STAGE, 'Applied', 'No response', 'Confirmation received', 'Screening',
                                            'Interview scheduled', 'Interviewing', 'Offer'))}
TERMINAL = {'Rejected', 'Withdrawn', 'Offer'}
BATCH = 8
INTERVIEWISH = re.compile(r'interview|screening|recruit|hiring|technical|intro(duction)? call|call with|onsite|panel', re.I)

SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['results'],
    'properties': {'results': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False,
        'required': ['index', 'relevant', 'application', 'company', 'role', 'kind', 'interview_at', 'summary', 'feedback'],
        'properties': {
            'index': {'type': 'integer'},
            'relevant': {'type': 'boolean', 'description': "About one of the owner's own job applications"},
            'application': {'type': 'integer', 'description': 'Index in the applications list, or -1'},
            'company': {'type': 'string', 'description': 'Hiring company (or platform) named in the item'},
            'role': {'type': 'string', 'description': 'Exact role title the item names (with its location suffix, e.g. "| Spain | Remote"), else ""'},
            'kind': {'type': 'string', 'enum': KINDS},
            'interview_at': {'type': 'string', 'description': 'ISO 8601 start of a scheduled call/interview with UTC offset, else ""'},
            'summary': {'type': 'string', 'description': 'What happened, max 120 characters, no personal data'},
            'feedback': {'type': 'string', 'description': 'Verbatim specific employer assessment, else empty. Exclude quoted old mail, generic rejections and candidate requests.'},
        }}}},
}

SYSTEM = """You sort the job-search emails (and calendar events) of the owner of Job Pilotto. For each item:
- "Feedback received" = an employer's assessment following a rejection, or feedback during an ongoing process.
  A rejection containing specific feedback stays "Rejected" with feedback filled. A refusal to provide feedback
  after a rejection also counts as Feedback received: quote the refusal, so no further request is suggested.
- feedback: quote the employer's specific reasons or assessment verbatim, never infer them. Empty for generic
  "other candidates were a better fit" wording. Exclude candidate requests and old messages quoted below a reply.
- relevant: true only when it is about one of the owner's own applications or hiring processes, or a recruiter or \
hiring person writes to the owner personally about a specific role. Automated job alerts, newsletters, marketing, \
"jobs you may like" and other people's mail are not relevant.
- application: the index of the matching application from the list, or -1 if none fits. When the owner applied \
to several roles at one company, pick the one whose title the item names; if it names none, pick -1 unless only \
one role at that company is open. Recruiter platforms (e.g. TechTree) may hide the employer: match on the \
platform ("Via") and role title.
- kind: "Confirmation received" = automatic acknowledgement that the application arrived. "Reply received" = a \
person or process answered without a time being fixed yet: an invitation to book or pick a slot, an assessment \
or test link, a recruiter's message. "Interview scheduled" = a specific call or interview was booked for a stated \
time (the booking confirmation or calendar invite itself). "Rejected" = not moving forward. "Offer" = an offer. \
\
"Recruiter outreach" = a recruiter or hiring person pitches the owner a role that isn't in the list (a first \
message, or LinkedIn's notification of one); a follow-up about a role already in the list is "Reply received". \
"Other" = relevant but none of these: reminders or "starting soon" notices for a call already booked, "still open" \
nudges, transcripts or recordings of a call, security codes, logistics.
- role: the role title exactly as the item writes it, including any location part; "" when it names none. An item \
naming a role that differs from every listed role at that company (e.g. another country) gets application -1.
- interview_at: only when a specific time is stated; ISO 8601 with offset (assume Europe/Zurich if none is given).
- summary: factual, short, no email addresses or phone numbers.
Answer for every item index."""


def load_state(path=STATE_FILE, ledger=None):
    """Emails already read and reminders already sent, for this ledger (📈 Application Events database).
    Read against another workspace, an email may have matched nothing there: start over when the ledger
    changes (the Source IDs already in the ledger still keep an email from being logged twice)."""
    ledger = EVENTS_DATABASE_ID if ledger is None else ledger
    try:
        state = json.loads(path.read_text())
    except (OSError, ValueError):
        state = {}
    if state.get('ledger') != ledger:
        state = {'seen': [], 'notified': state.get('notified', [])}
    return {'ledger': ledger, 'seen': state.get('seen', []), 'notified': state.get('notified', [])}


def save_state(state, path=STATE_FILE):
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {'ledger': state.get('ledger', EVENTS_DATABASE_ID), 'seen': state['seen'][-3000:],
             'notified': state['notified'][-1000:]}
    path.write_text(json.dumps(state))


def applications(tracker):
    """Applications that emails and events can belong to, oldest first (stable indexes)."""
    stages = lambda names: {'or': [{'property': 'Stage', 'select': {'equals': stage}} for stage in names]}
    try:
        rows = tracker.query_database(tracker.database_id, stages(OUTCOME_STAGES + (opportunity.LEAD_STAGE,)))
    except urllib.error.HTTPError as error:
        # A workspace without the "Recruiter lead" choice yet (it's added by the app's repair, or by the first lead):
        # Notion refuses a filter on an unknown choice, and then there are no leads to match anyway.
        if error.code != 400:
            raise
        rows = tracker.query_database(tracker.database_id, stages(OUTCOME_STAGES))
    return sorted(rows, key=lambda r: (plain(r['properties'].get('Applied on')) or '', r['id']))


def _field(row, name):
    return plain(row['properties'].get(name)) or ''


def verified_feedback(value, original):
    """The mail reader may classify, but it cannot invent employer quotations."""
    normal = lambda text: re.sub(r'\s+', ' ', text or '').strip()
    value = (value or '').strip()
    return value if len(value) >= 10 and normal(value) in normal(original) else ''


def query(apps, days):
    """One Gmail search: known senders, application-ish subjects, or a tracked company's name."""
    names = {n for r in apps for n in (_field(r, 'Company'), _field(r, 'Via')) if n and len(n) > 2 and len(n) < 40}
    roles = role_words()
    short = tuple(dict.fromkeys(s for key, s in ROLE_SHORT.items() if any(key in r.lower() for r in roles)))
    terms = ([f'from:{d}' for d in SENDER_DOMAINS + LINKEDIN_SENDERS] + [f'subject:"{w}"' for w in SUBJECT_WORDS + roles + short]
             + [f'"{n}"' for n in sorted(names)])
    return f'newer_than:{days}d -in:chats -in:spam -in:trash -in:sent {{{" ".join(terms)}}}'


def extra_query(days):
    """A second, short search (a single long one risks Gmail's query limit): recruitment agencies and emailed
    calendar invitations, which the first search misses when nothing about them is tracked yet."""
    terms = [f'from:{d}' for d in RECRUITER_DOMAINS] + [INVITES]
    return f'newer_than:{days}d -in:chats -in:spam -in:trash -in:sent {{{" ".join(terms)}}}'


def role_words():
    """The user's own job-board searches ("site reliability engineer", "devops"): a recruiter's subject line
    usually names the role."""
    from ..paths import load_search_config
    try:
        queries = load_search_config().get('jobs_board_search_queries') or []
    except (OSError, ValueError):
        return ()
    return tuple(q for q in queries if isinstance(q, str) and 2 < len(q) < 40 and '"' not in q)


def listing(apps):
    return '\n'.join(f"{i}. {_field(r, 'Company') or '(employer not named)'} — {_field(r, 'Job')} (stage {_field(r, 'Stage')}"
                     f"{', via ' + _field(r, 'Via') if _field(r, 'Via') else ''}"
                     f"{', recruiter ' + _field(r, 'Contact') if _field(r, 'Contact') else ''}, applied {_field(r, 'Applied on') or '?'})"
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


# The fields an email can move on a job, as (before, after) in the event's Changes: "Not this job" puts them back.
UNDOABLE = ('Stage', 'Next interview', 'Feedback status', 'Confirmation email')


def _value(row, name):
    prop = row['properties'].get(name) or {}
    if 'checkbox' in prop:
        return bool(prop['checkbox'])
    return _field(row, name) or None


def advance(tracker, row, kind, interview_at=None, now=None, *, by_app=None, feedback_text=''):
    """Move a job forward for one email (Stage forward only, Next interview, flags). Returns {field: [before, after]}."""
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
    return {name: [before[name], _value(row, name)] for name in changes}


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


def record(tracker, row, kind, at, source, source_id, note, index, interview_at=None, now=None, feedback_text='', email=None):
    """Write one matched item: event (or link to a hand-logged twin), Stage forward, Next interview.
    Returns a short description of what changed, or None when it was already known."""
    key = row['id'].replace('-', '')
    known, by_app = index
    if source_id in known:
        return None
    if feedback_text and kind != 'Rejected':
        kind = employer_feedback.RECEIVED
    if kind == employer_feedback.RECEIVED and not feedback_text.strip():
        return None  # no model guesses stored as employer evidence
    twin = _near(by_app.get(key, []), kind, at) if kind != employer_feedback.RECEIVED else None
    if twin and twin[1]:
        return None
    if feedback_text:
        employer_feedback.receive(tracker, row, feedback_text)
    event = {'id': twin[0]} if twin else add_event(tracker, row, kind, source, at=at, note=note)
    by_app.setdefault(key, []).append((kind, at, event['id'], source_id))
    fields = advance(tracker, row, kind, interview_at, now, by_app=by_app, feedback_text=feedback_text)
    tracker.update_page(event['id'], {'Source ID': {'rich_text': [{'text': {'content': source_id}}]}, 'At': {'date': {'start': at}}})
    _optional(tracker.update_page, event['id'], {'Changes': changes_text(fields, interview_at, email)})
    known.add(source_id)
    stage = (fields.get('Stage') or [None, None])[1]
    return None if twin else stage or kind


# ---- Not sure which job: ask ----
# An email the check can't place for certain becomes an event on no job, with "Needs you" and the job it would
# have picked ("Suggested job"): Focus asks "Is this about …?" and src/ai/reassign.py applies the answer.
EVENT_KIND = {OUTREACH: opportunity.LEAD_STAGE}


NEW_COLUMNS = ('Changes', 'Needs you', 'Suggested job')  # added 29 Sep 2026; the app adds them to older workspaces


def _optional(write, *args):
    """A write to a column a workspace may not have yet (NEW_COLUMNS): never fails the check."""
    try:
        write(*args)
    except urllib.error.HTTPError as error:
        print(f'Warning: not saved ({error.code}): the workspace may miss a new column; the app adds it.', file=sys.stderr)


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
    lines.append(f"❓ {escape(result.get('company') or email['subject'][:60])}: {escape(result.get('summary') or kind)}"
                 f" — which job{escape(guess)}? Answer in Job Pilotto (Focus).")
    if stats is not None:
        stats.setdefault('updates', []).append(f"❓ {kind} · {result.get('company') or subject[:60]} — which job?"[:140])


ENDED = {'Rejected', 'Withdrawn', 'Closed', 'Dismissed', 'No response', 'Not seen'}
STOP = {'senior', 'staff', 'lead', 'principal', 'engineer', 'the', 'and', 'for', 'with', 'remote', 'hybrid', 'of', 'm', 'f', 'd', 'w'}


def _ambiguous(apps, row, email):
    """True when the same employer or agency has another open role and the email doesn't name this one's title:
    one agency, two of your roles — the AI's pick is a guess then."""
    words = lambda text: set(re.findall(r'[a-z0-9]+', (text or '').lower()))
    org = lambda r: ' '.join(sorted(words(_field(r, 'Company') or _field(r, 'Via'))))
    mine = org(row)
    if not mine or not any(r is not row and org(r) == mine and _field(r, 'Stage') not in ENDED for r in apps):
        return False
    title = words(_field(row, 'Job')) - STOP
    text = words(f"{email.get('subject', '')} {email.get('body', '')[:6000]}")
    return bool(title) and len(title & text) < max(1, (len(title) + 1) // 2)


EMOJI = {'Confirmation received': '📬', REPLY: '💬', OUTREACH: '🤝', 'Interview scheduled': '🗓', 'Rejected': '❌', 'Offer': '🎉', 'Other': '•', employer_feedback.RECEIVED: '💬'}


SHORT_KIND = {'Confirmation received': 'Application received'}


def _short(stats, kind, row, extra=''):
    """One short plain line per recorded update, for the desktop app ("❌ Rejected · Grafana Labs — SRE")."""
    if stats is not None:
        job = re.sub(r'\s*\|\s*Remote\s*$', '', _field(row, 'Job'))[:70]
        stats.setdefault('updates', []).append(
            f"{EMOJI.get(kind, '•')} {SHORT_KIND.get(kind, kind)} · {_who(row)} — {job}{extra}")


def _who(row):
    """The employer, or for a recruiter lead with a hidden one, the agency."""
    return _field(row, 'Company') or _field(row, 'Via') or _field(row, 'Contact').split(' · ')[0] or '?'


def _label(row):
    return f"{escape(_who(row))} — {escape(_field(row, 'Job'))[:60]}"


def mail_pass(tracker, google, client, model, apps, index, state, days, stats, dry_run=False, now=None, rejected=None,
              on_new=None):
    """Process new emails; returns (lines for Telegram, count classified)."""
    seen = set(state['seen'])
    found = list(dict.fromkeys(google.search(query(apps, days), limit=60) + google.search(extra_query(days), limit=30)))
    ids = [i for i in found if i not in seen and i not in index[0]]
    emails = sorted((google.message(i) for i in ids), key=lambda m: m['date'])
    if not emails:
        return [], 0
    results = classify(client, model, apps, emails, stats)
    lines = []
    for i, email in enumerate(emails):
        result = results.get(i) or {'relevant': False}
        if email.get('invite_at') and result.get('relevant'):
            # The invitation's own start (its calendar part), never a time the AI read from the text.
            result['interview_at'] = email['invite_at']
        row = apps[result['application']] if result.get('relevant') and 0 <= result.get('application', -1) < len(apps) else None
        guess = None  # the job the AI picked but can't be trusted with: suggested when the owner is asked
        if row is not None and not _names_it(row, email):
            # The AI matched on the role alone (an SRE invitation from one agency, a DevOps pitch from another): an
            # email is attached to a job only if it names that job's company, agency or a contact.
            print(f"Not attached to {_label(row)}: the email ({email['from'][:60]}) names none of it", file=sys.stderr)
            guess, row = row, None
        elif row is not None and _ambiguous(apps, row, email):
            # The same agency or employer has another of your roles, and the email doesn't say which: ask.
            print(f"Not sure it's {_label(row)}: {_field(row, 'Via') or _field(row, 'Company')} has another open role", file=sys.stderr)
            guess, row = row, None
        named = result.get('relevant') and not row and result.get('role') and result.get('company') \
            and result.get('kind') in TRACKABLE
        if result.get('relevant') and not row and not named:  # e.g. a scheduler email naming only the recruiter
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
        if result.get('kind') == OUTREACH:
            if not row:
                lines += new_lead(tracker, client, model, email, apps, stats, on_new)
                continue
            result['kind'] = REPLY  # the same recruiter again, about a role already tracked
        if not row and result.get('kind') == 'Interview scheduled':
            # The same recruiter about the same call, by email and on LinkedIn: the job that has this person.
            same = [r for r in apps if _names_person(r, f"{email['from']} {email['subject']} {email['body'][:4000]}")]
            if len(same) == 1:
                row = same[0]
        if not row and result.get('kind') == 'Interview scheduled' and not _about_tracked(
                apps, f"{result['company']} {email['from']} {email['subject']} {email['body'][:1500]}"):
            # An interview for a job not tracked yet (often via an agency, the employer unnamed): track it from the
            # email and let Focus ask for the missing details, rather than drop it or name the job after the agency.
            row = interview_lead(tracker, client, model, email, apps, result, stats)
            if row is not None:
                lines.append(f"❓ {_label(row)}: an interview, but which job? Add the details in Job Pilotto "
                             "(Focus → Add details: paste the LinkedIn chat or the job link).")
        if not row and named:
            # The email names a role that isn't tracked (applied elsewhere, or before Job Pilotto): track it.
            row = _from_email(tracker, apps, result, email, stats, lines, on_new)
        if not row:
            # Not sure which job (or whether it's one you track): never guess, ask. Focus shows "Is this about …?"
            # with the likeliest job; the answer is applied by src/ai/reassign.py.
            text = f"{result.get('company') or ''} {email['from']} {email['subject']} {email['body'][:1500]}"
            candidates = [r for r in apps if _about_tracked([r], text)]
            ask(tracker, email, result, guess or (candidates[0] if candidates else None), index, lines, stats)
            continue
        changed = record(tracker, row, result['kind'], email['date'], 'Gmail', email['id'],
                         f"{result['summary']} (email: \"{email['subject'][:120]}\")", index, result['interview_at'], now,
                         feedback_text=verified_feedback(result.get('feedback'), email['body']), email=email)
        if changed:
            when = _when(result['interview_at'] or '')
            extra = f" · {when.astimezone(TZ):%a %d %b %H:%M}" if when else ''
            lines.append(f"{EMOJI.get(result['kind'], '•')} {_label(row)}: {escape(result['summary'])}{extra}")
            _short(stats, result['kind'], row, extra)
            if changed == 'Rejected' and rejected is not None:
                rejected.append((row, email))
    return lines, len(emails)


def review_rejections(tracker, client, rejected, stats, backfill=2):
    """Why each new rejection happened (rejection.review, Sonnet 5), then up to `backfill` older rejections
    without a review. Lines for Telegram; a failed review is logged and retried next time (it stays pending)."""
    from ..features import disabled
    from . import rejection
    if disabled('rejection_review'):
        return []
    lines, done, profile = [], set(), None
    todo = [(row, f"Subject: {email['subject']}\n\n{email['body']}") for row, email in rejected]
    try:
        todo += [(row, '') for row in rejection.pending(tracker, backfill) if row['id'] not in {r['id'] for r, _ in rejected}]
    except Exception as error:  # noqa: BLE001
        print(f'Warning: rejected applications not listed: {type(error).__name__}: {error}', file=sys.stderr)
    for row, email_text in todo:
        if row['id'] in done:
            continue
        done.add(row['id'])
        row['properties']['Stage'] = {'type': 'select', 'select': {'name': 'Rejected'}}
        try:
            profile = tracker.page_text() if profile is None else profile
            _, summary = rejection.review(tracker, row, email_text=email_text, client=client, stats=stats, profile=profile)
        except Exception as error:  # noqa: BLE001 — the Gmail check's own updates are already saved
            print(f'Warning: rejection review failed for {_label(row)}: {type(error).__name__}: {error}', file=sys.stderr)
            continue
        lines.append(escape(summary))
        if stats is not None:
            stats.setdefault('updates', []).append(summary)  # whole: the app wraps it
    return lines


TRACKABLE = ('Confirmation received', REPLY, 'Interview scheduled', 'Rejected', 'Offer')


def _from_email(tracker, apps, result, email, stats, lines, on_new=None):
    """An Applications row for the role an email names (Stage Applied; the email's own event then moves it on).
    Keyed by company + role, so a second email about it (a duplicate, the rejection after the confirmation) finds it."""
    company, role = result['company'].strip(), result['role'].strip()
    words = lambda text: ' '.join(re.findall(r'[a-z0-9]+', text.lower()))
    same = [r for r in apps if words(_field(r, 'Company')) == words(company)
            and words(_field(r, 'Job')) and (words(role) in words(_field(r, 'Job')) or words(_field(r, 'Job')) in words(role))]
    if same:
        return same[0]
    applied = (email['date'] or '')[:10]
    # The role may be on the list before it was applied to (Saved, Kit ready…) and applied to without marking it:
    # that row becomes the application, so the job keeps its posting, kit and fit instead of getting a twin.
    try:
        earlier = [r for r in tracker.query_database(tracker.database_id, {'property': 'Company', 'rich_text': {'equals': company}})
                   if words(_field(r, 'Job')) and (words(role) in words(_field(r, 'Job')) or words(_field(r, 'Job')) in words(role))]
    except Exception:  # noqa: BLE001 — then a new row, as before
        earlier = []
    if earlier:
        row = earlier[0]
        before = _field(row, 'Stage') or 'on your list'
        changes = {'Stage': {'select': {'name': 'Applied'}}, 'Date approximate': {'checkbox': True}}
        if applied and not _field(row, 'Applied on'):
            changes['Applied on'] = {'date': {'start': applied}}
        tracker.update_page(row['id'], changes)
        for name, value in changes.items():
            row['properties'][name] = {'type': next(iter(value)), **value}
        add_event(tracker, row, 'Applied', 'Gmail', at=applied or None,
                  note=f'Applied without marking it; found in the email "{email["subject"][:120]}" (date is an upper bound)')
        apps.append(row)
        lines.append(f"➕ {_label(row)}: marked applied from this email (it was {escape(before)}).")
        if stats is not None:
            stats.setdefault('updates', []).append(f"➕ Marked applied · {company} — {role[:70]}")
        return row
    url = f'https://mail.google.com/mail/u/0/#all/{email["id"]}'
    props = {'Job': {'title': [{'text': {'content': role[:200]}}]}, 'Company': {'rich_text': [{'text': {'content': company[:200]}}]},
             'Job URL': {'url': url}, 'Stage': {'select': {'name': 'Applied'}}, 'Source': {'select': {'name': 'Gmail'}},
             'Date approximate': {'checkbox': True},
             'Notes': {'rich_text': [{'text': {'content': f'Tracked from an email: "{email["subject"][:150]}"'}}]}}
    if applied:
        props['Applied on'] = {'date': {'start': applied}}
    row = tracker.create_page(tracker.database_id, props)
    known = row.setdefault('properties', {})  # Notion returns the new row's properties; test fakes may not
    for name, value in (('Company', {'rich_text': [{'plain_text': company}]}), ('Job', {'title': [{'plain_text': role}]}),
                        ('Stage', {'select': {'name': 'Applied'}}), ('Applied on', {'date': {'start': applied}})):
        known.setdefault(name, value)
    row.setdefault('url', '')
    add_event(tracker, row, 'Applied', 'Gmail', at=applied or None,
              note=f'Applied outside Job Pilotto; found in the email "{email["subject"][:120]}" (date is an upper bound)')
    apps.append(row)
    if on_new:  # facts and fit score from the email, like a found job (src/ai/added.py)
        on_new(url, {'title': role, 'company': company, 'description': f"{email['subject']}\n\n{email['body']}"[:8000]}, row)
    lines.append(f"➕ {_label(row)}: tracked from this email (applied elsewhere).")
    if stats is not None:
        stats.setdefault('updates', []).append(f"➕ Tracked · {company} — {role[:70]}")
    return row


def _sender_org(sender):
    """"Huxley" from "Jaya <j.nejati@huxley.com>": the agency or company an email comes from."""
    domain = (re.search(r'@([\w.-]+)', sender or '') or [None, ''])[1].lower()
    parts = [p for p in domain.split('.') if p not in ('mail', 'email', 'co', 'com', 'ch', 'de', 'io', 'uk', 'net', 'org')]
    org = parts[-1] if parts else ''
    return '' if org in PLATFORMS else org.capitalize()


# Where a message comes from, not who sends it: never an agency or employer.
PLATFORMS = {'linkedin', 'gmail', 'googlemail', 'google', 'outlook', 'hotmail', 'live', 'yahoo', 'icloud', 'me', 'proton',
             'protonmail', 'gmx', 'calendly', 'cal', 'zoom', 'teams', 'microsoft', 'xing', 'indeed', 'glassdoor'}


def interview_lead(tracker, client, model, email, apps, result, stats):
    """An interview invitation about a job nothing tracks yet: the Applications row from the email (role, agency,
    contact, the message), at Screening; the caller then records the interview (Stage Interview scheduled, Next
    interview). The employer is often unnamed: Focus then asks the owner to add the details. None if not tracked."""
    text = f"Subject: {email['subject']}\n\n{email['body']}"
    try:
        lead = opportunity.extract(client, model, text, sender=email['from'], stats=stats)
    except Exception as error:  # noqa: BLE001 — the email's own facts are enough to track it
        print(f"Warning: interview email {email['id']} not read: {type(error).__name__}: {error}", file=sys.stderr)
        lead = {}
    linkedin = 'linkedin.com' in email['from'].lower()
    lead = {**lead, 'title': lead.get('title') or result.get('role') or email['subject'][:120],
            'company': lead.get('company') or '', 'platform': 'LinkedIn' if linkedin else 'Email'}
    if (lead.get('recruiter_company') or '').lower() in PLATFORMS:
        lead['recruiter_company'] = ''
    if not lead.get('company') and not lead.get('recruiter_company'):
        lead['recruiter_company'] = _sender_org(email['from'])
    if not linkedin and not lead.get('recruiter_email'):  # the next email from this person finds this job
        parsed = re.match(r'\s*"?([^"<]*)"?\s*<([^>]+)>', email['from'])
        name, address = parsed.groups() if parsed else ('', email['from'])
        lead['recruiter_email'] = address.strip()
        lead['recruiter_name'] = lead.get('recruiter_name') or person_name(name)
    try:
        row, _ = opportunity.track(tracker, lead, text, source='Gmail', event_source='Gmail', talking=True,
                                   at=email['date'], gmail_id=email['id'],
                                   note=f"Interview invitation: \"{email['subject'][:120]}\"")
    except Exception as error:  # noqa: BLE001
        print(f"Warning: interview email {email['id']} not tracked: {type(error).__name__}: {error}", file=sys.stderr)
        return None
    if row is not None:
        apps.append(row)
        if stats is not None:
            stats.setdefault('updates', []).append(f"❓ Interview · {opportunity.label(lead)} — which job? Add details"[:140])
    return row


def new_lead(tracker, client, model, email, apps, stats, on_new=None):
    """A recruiter's pitch -> a tracked recruiter lead (opportunity.track); lines for Telegram."""
    text = f"Subject: {email['subject']}\n\n{email['body']}"
    try:
        lead = opportunity.extract(client, model, text, sender=email['from'], stats=stats)
    except Exception as error:  # noqa: BLE001 — one unreadable email must not stop the check
        print(f"Warning: recruiter email {email['id']} not read: {type(error).__name__}: {error}", file=sys.stderr)
        return []
    if not lead.get('is_opportunity'):
        return []
    row, _ = opportunity.track(tracker, lead, text, source='Gmail', event_source='Gmail', at=email['date'],
                               gmail_id=email['id'], note=f"Recruiter email: \"{email['subject'][:120]}\"")
    if not row:
        return []
    apps.append(row)  # a second email in this batch about the same role matches it
    fit = on_new(opportunity.lead_url(lead, text, email['id']), {
        'title': opportunity.title(lead), 'company': lead.get('company') or '', 'location': lead.get('location') or '',
        'work_mode': lead.get('work_mode') or '', 'description': text[:8000]}, row) if on_new else None
    if stats is not None:
        stats.setdefault('updates', []).append(f"🤝 Recruiter lead · {opportunity.label(lead)}"[:140])
    link = (f"\n<a href=\"{escape(row['url'], quote=True)}\">In Notion</a> — set Stage to Screening once you reply"
            if row.get('url') else '')
    return [f"🤝 New recruiter lead: <b>{escape(opportunity.label(lead))}</b>"
            + (f" · {escape(lead['salary'])}" if lead.get('salary') else '') + (f" · {escape(fit)}" if fit else '') + link]


def _contact_names(row):
    """Full names written in the Contact field ("Alex Morgan · alex@yupe.io" -> "alex morgan")."""
    return {m.lower() for m in re.findall(r"\b[A-Z][a-zà-ÿ'-]+ [A-Z][a-zà-ÿ'-]+\b", _field(row, 'Contact'))}


def person_name(value):
    """"Jayantie Nejati" from "Seosahai - Nejati, Jayantie" (Outlook's "Last, First" with a prefix)."""
    value = (value or '').strip()
    if ',' in value:
        last, first = value.split(',', 1)
        value = f"{first.strip()} {last.split('-')[-1].strip()}"
    return re.sub(r'\s+', ' ', value).strip()


def _names_person(row, text):
    """True if the text names this job's contact person: first and last name both, in any order or format."""
    words = set(re.findall(r'[a-zà-ÿ]+', text.lower()))
    for person in _field(row, 'Contact').split(' · '):
        if '@' in person:
            continue
        parts = {w for w in re.findall(r'[a-zà-ÿ]+', person_name(person).lower()) if len(w) >= 3}
        if len(parts) >= 2 and len(parts & words) >= 2:
            return True
    return False


def _names_it(row, email):
    """True if the email names the application: its company, agency, contact (name or email), or comes from the
    domain of one of its contacts. A job with nothing to name (no company, agency or contact) can't be checked."""
    names = [n for n in (_field(row, 'Company'), _field(row, 'Via'), _field(row, 'Contact')) if n.strip()]
    if not names:
        return True
    text = f"{email.get('from', '')} {email.get('subject', '')} {email.get('body', '')[:6000]}"
    if _matches(row, text):
        return True
    domains = {d for d in re.findall(r'@([\w-]+\.[\w.-]+)', _field(row, 'Contact').lower())}
    sender = (re.search(r'@([\w.-]+)', email.get('from', '')) or [None, ''])[1].lower()
    squash = lambda value: re.sub(r'[^a-z0-9]', '', value.lower())
    orgs = [squash(n) for n in (_field(row, 'Company'), _field(row, 'Via')) if len(squash(n)) > 3]
    return bool(sender and (any(sender.endswith(d) for d in domains)  # a contact's own domain
                            or any(o in squash(sender.split('.')[0]) or squash(sender.split('.')[0]) in o
                                   for o in orgs if len(squash(sender.split('.')[0])) > 3)))  # agtalent.co.uk = AG Talent


def _matches(row, text):
    """True if the text names this application's company, platform, a contact's name or email."""
    text = text.lower()
    names = [n.lower() for n in (_field(row, 'Company'), _field(row, 'Via')) if len(n) > 2]
    names += [n.split()[0].lower() for n in names if len(n.split()[0]) >= 5]
    names += sorted(_contact_names(row))
    emails = re.findall(r'[\w.+-]+@[\w-]+\.[\w.-]+', _field(row, 'Contact').lower())
    return (any(re.search(rf'(?<![\w]){re.escape(n)}(?![\w])', text) for n in names) or any(e in text for e in emails)
            or _names_person(row, text))


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
                _short(stats, 'Interview scheduled', row, f" · {start.astimezone(TZ):%a %d %b %H:%M}")
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
        now=None, state_path=STATE_FILE, stats=None, on_new=None, always_report=False):
    """always_report: a check you started (Telegram button, the app, GitHub's Run button) answers even when
    there's nothing new, so "news arrives in about a minute" is always followed by a message."""
    state = load_state(state_path)
    apps = applications(tracker)
    index = _events_index(tracker)
    if client is None:
        import anthropic
        client = anthropic.Anthropic()
    rejected = []
    lines, count = mail_pass(tracker, google, client, model, apps, index, state, days, stats, dry_run, now, rejected,
                             None if dry_run else on_new)
    if stats is not None:
        stats.update(pending=count, done=count)
    notes = []
    if calendar:
        cal_lines, notes = calendar_pass(tracker, google, client, model, apps, index, state, stats, now, dry_run)
        lines += cal_lines
    if not dry_run:
        save_state(state, state_path)
        lines += review_rejections(tracker, client, rejected, stats)
    if send and lines:
        send('📧 <b>Job emails and calendar</b>\n' + '\n'.join(lines))
    elif send and always_report and not notes:
        send(f'📧 Gmail checked: {count} new email(s), nothing that changes your applications.' if count
             else '📧 Gmail checked: no new job emails.')
    for note in notes:
        if send:
            send(note)
    if (stats or {}).get('updates') and not dry_run:  # one short line each, for the desktop app's activity panel
        print('Updates:')
        for line in stats['updates']:
            print(line)
    usd = (stats or {}).get('usd', 0.0)
    return f'Mail: {count} new email(s) classified, {len(lines)} update(s), {len(notes)} reminder(s) (${usd:.3f})'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--days', type=int, default=2, help='how far back to search Gmail')
    parser.add_argument('--send', action='store_true', help='send the summary and reminders to Telegram')
    parser.add_argument('--dry-run', action='store_true', help='classify and print; write nothing')
    parser.add_argument('--no-calendar', action='store_true')
    parser.add_argument('--always-report', action='store_true',
                        help='with --send: answer even when nothing is new (a check someone started)')
    parser.add_argument('--log-run', action='store_true',
                        help='log this check to Notion ⏰ Search runs even without --send (the desktop app always does)')
    args = parser.parse_args(argv)
    tracker, google = notion.Tracker.from_env(), Google.from_env()
    if not google:
        print('Gmail + Calendar is off: Google is not connected or JOB_PILOTTO_DISABLE includes mail. '
              'See README → Gmail and Calendar.')
        return 0
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required')
    sender = None
    from ..features import disabled
    if args.send and not disabled('telegram'):
        token, chat_id = telegram.credentials()
        sender = lambda text: telegram.send(text, token, chat_id)
    stats = {}
    logged = (args.send or args.log_run) and not args.dry_run
    if logged:
        cron_runs.auto_begin(tracker)  # the check's ⏱️ Search runs row opens when it starts
    log = cron_runs.new_run('mail')

    def log_check(warning=None):  # one ⏰ Search runs row per check: what it read, what it recorded, the cost
        log['mail'] = {key: value for key, value in stats.items() if key != 'updates'}
        log['updates'] = stats.get('updates', [])
        log['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(log['started_at'])).total_seconds())
        if warning:
            log['warnings'].append(warning)
        url = cron_runs.log_run(tracker, log)
        if url:
            print(f'Cronjob run logged: {url}')

    try:
        from ..paths import JOBS_DB
        from . import added  # jobs tracked from an email get facts and a fit score, like found ones
        print(run(tracker, google, days=args.days, send=sender, calendar=not args.no_calendar, dry_run=args.dry_run,
                  stats=stats, on_new=added.hook(tracker, JOBS_DB, log), always_report=args.always_report))
        if logged:
            log_check()
    except Exception as error:  # noqa: BLE001 — a spend limit is expected, not a crash
        if logged:
            log_check(f'check failed: {type(error).__name__}: {str(error)[:200]}')
        if 'invalid_grant' in str(error):
            message = ('⚠️ The Google sign-in for Gmail and Calendar has expired (Google limits apps in testing mode '
                       'to 7 days). On the Mac, in the repo, run: python3 -m src.sources.google auth --github '
                       '(add --client-json <file> if you use your own Google app)')
            print(message)
            if sender:
                sender(escape(message))
            return 0
        if cost.limit_reached(error):
            print(f'Mail check skipped: the Anthropic API spend limit is reached ({error}). '
                  'Raise it in the Anthropic console, or it resumes when the limit resets.')
            return 0
        raise
    return 0


if __name__ == '__main__':
    sys.exit(main())
