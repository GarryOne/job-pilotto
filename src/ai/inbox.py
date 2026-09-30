#!/usr/bin/env python3
"""📥 Log anything: a pasted message or a screenshot (LinkedIn, Gmail, WhatsApp…) -> the right job, updated or created.

Claude Haiku 4.5 reads the text or the image once, together with the list of jobs Notion already knows (tracked
applications first, then open Job Matches), and says what it is and which job it's about:

- **a job already tracked** in Applications -> its event (reply, interview time, rejection, offer…) and Stage moved
  forward (never back, like the Gmail check); a recruiter writing about a saved job makes it a Recruiter lead.
- **an open job** in Job Matches, not tracked yet -> an Applications row for that job (its own URL), then the event.
- **nothing known** -> a new row: a recruiter's pitch becomes a Recruiter lead (src/ai/opportunity.py); an
  application, reply, interview or outcome for another role is tracked as applied elsewhere, then the event.

The message and the screenshot are kept on the job's page. The same paste twice changes nothing (Source ID).

Usage:
  python -m src.ai.inbox --text-file message.txt [--image shot.png] [--talking]
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from ..notion import client as notion, ledger
from ..notion import origin as origin_rule, titles
from ..notion.ledger import REPLY, _block, add_event, plain
from . import added, cost, mail, opportunity

DEFAULT_MODEL = opportunity.DEFAULT_MODEL
OUTREACH, APPLIED, NOT_JOB = 'Recruiter outreach', 'Applied', 'Not job-related'
KINDS = [OUTREACH, APPLIED, 'Confirmation received', REPLY, 'Interview scheduled', 'Rejected', 'Offer', NOT_JOB, mail.employer_feedback.RECEIVED]
MEDIA = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'}
MAX_JOBS = 300
LOG_HEADING = '📥 Logged'
GONE = {'Not seen', 'Closed', 'Dismissed'}
EARLY = {None, '', 'Saved', 'Kit ready', 'Applying'}  # no application sent yet
EMOJI = {**mail.EMOJI, OUTREACH: '🤝', APPLIED: '📨'}

# Whether the owner agreed to talk to the recruiter, read from the conversation itself (owner's rule, 30 Sep 2026: no
# checkbox before the reading; the confirmation step asks only when the reply is 'unclear').
AGREEMENT = ('shown', 'declined', 'none', 'unclear')
AGREE_QUESTION = 'Did you agree to talk to the recruiter?'

# What the item shows outright vs what was inferred: the app asks about everything not shown (owner's rule, 30 Sep
# 2026: never guess what can't be seen; ask in the confirmation step).
SEEN = {
    'type': 'object', 'additionalProperties': False,
    'required': ['channel', 'year', 'first_contact', 'interview', 'company', 'agreement'],
    'properties': {
        'channel': {'type': 'string', 'enum': ['shown', 'guessed', 'unknown'], 'description':
                    'shown = the platform is plainly visible (LinkedIn\'s chat UI or name, an email\'s From/Subject header); '
                    'guessed = only from the look or the wording; unknown'},
        'year': {'type': 'string', 'enum': ['shown', 'missing'], 'description':
                 'shown = the dates in the item include the year; missing = only day/month, a weekday or a time'},
        'first_contact': {'type': 'string', 'enum': ['shown', 'guessed', 'unknown'], 'description':
                          'shown = the date of the earliest message is visible; guessed; unknown'},
        'interview': {'type': 'string', 'enum': ['shown', 'partial', 'none'], 'description':
                      'shown = a call/interview with its full date and time; partial = a call mentioned without a full '
                      'date and time ("Friday at 3", "next week"); none = no call mentioned'},
        'company': {'type': 'string', 'enum': ['shown', 'guessed', 'unknown'], 'description':
                    'shown = the hiring company is named; guessed = inferred (e.g. from an agency or a logo); unknown'},
        'agreement': {'type': 'string', 'enum': list(AGREEMENT), 'description':
                      'Did the owner agree to talk? shown = the owner said yes, agreed to a call or booked one '
                      '(owner_agreed true); declined = the owner said no / not interested; none = the owner has not '
                      'replied (nothing to tell); unclear = the owner replied, but not clearly yes or no to talking'},
    },
}

# Who wrote last in the conversation shown, and when (the same single reading): Focus recommends a follow-up when your
# message got no answer (src/focus.py follow_up). The date comes from what is written ("MONDAY", "Today", "Sep 28"),
# resolved against the day it's logged by resolve_day(), never from the model's own date guess.
LAST_MESSAGE = {
    'type': 'object', 'additionalProperties': False,
    'required': ['from', 'at', 'at_text', 'text_snippet'],
    'properties': {
        'from': {'type': 'string', 'enum': ['you', 'them', 'unknown'], 'description':
                 'Who wrote the last visible message: you = the owner, them = the recruiter or employer, unknown = unclear'},
        'at': {'type': 'string', 'description': 'ISO 8601 date/time of that message only when a full date with its year is shown, else ""'},
        'at_text': {'type': 'string', 'description': 'Its day and time exactly as shown: the day divider above it and its time '
                                                     '("MONDAY 12:33 AM", "Today 09:10", "Sep 28", "28/09/2026 14:02"), else ""'},
        'text_snippet': {'type': 'string', 'description': 'Its first words, as written, at most 120 characters'},
    },
}

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['kind', 'match', 'role', 'when', 'first_contact', 'interview_at', 'feedback', 'job_description',
                 'seen', 'first_contact_text', 'interview_text', 'last_message']
                + opportunity.SCHEMA['required'],
    'properties': {
        'kind': {'type': 'string', 'enum': KINDS},
        'match': {'type': 'integer', 'description': 'Index of the job in the list this is about, or -1 if none fits'},
        'role': {'type': 'string', 'description': 'Role title the item names, else ""'},
        'when': {'type': 'string', 'description': 'ISO 8601 date/time the message was sent if shown, else ""'},
        'job_description': {'type': 'string', 'description': 'Everything the item says about the role itself, as written (for screenshots: transcribed): responsibilities, stack, team, requirements, the company or client, location, work mode, contract, pay, interview process. Not greetings or small talk. "" if it says nothing about the role'},
        'first_contact': {'type': 'string', 'description': 'ISO 8601 date of the earliest message shown in the conversation (the first time they talked), else ""'},
        'interview_at': {'type': 'string', 'description': 'ISO 8601 start of a call/interview with a fixed time, with offset, else ""'},
        'feedback': {'type': 'string', 'description': 'Specific employer feedback quoted verbatim, else empty; no generic rejections or inferred reasons.'},
        'seen': SEEN,
        'first_contact_text': {'type': 'string', 'description': 'The earliest date exactly as written in the item, with the day divider above the first message and its time ("Sep 21", "MONDAY 12:33 AM", "Mon 14:02", "21/09/2026"), else ""'},
        'last_message': LAST_MESSAGE,
        'interview_text': {'type': 'string', 'description': 'A call/interview time exactly as written ("Friday at 3pm", "26 Sep 15:00"), else ""'},
        **opportunity.SCHEMA['properties'],
    },
}

SYSTEM = """The owner of Job Pilotto pastes a message or a screenshot (LinkedIn, Gmail, WhatsApp, a job site) about their \
job search. Read it (for a screenshot, read the text in the image) and say:
- "Feedback received" = the employer's specific assessment during or after a hiring process. A rejection
  containing specific feedback stays "Rejected" with feedback filled. feedback is a verbatim quote of the
  employer's reasons or assessment; empty for generic rejections. Never turn the candidate's own request,
  quoted old messages, or a model guess into employer feedback.
- kind: "Recruiter outreach" = a recruiter or hiring person pitches a role; "Applied" = proof the owner applied (an \
application page or a copy of it); "Confirmation received" = automatic acknowledgement; "Reply received" = a person \
answered without a fixed time (booking link, test, questions, "let's chat"); "Interview scheduled" = a call booked at a \
stated time; "Rejected"; "Offer"; "Not job-related" = anything else, including people selling services to the \
owner (web design, marketing, outsourcing), networking or event invitations, and automated job alerts.
- match: the index of the job in the list below that the item is about (same company, or same agency/recruiter, and \
same role), or -1. The list includes pitches already logged: the same recruiter pitching the same role again (or the \
same message pasted twice) is that job. When the company has several roles and the item doesn't say which, answer -1.
- The other fields: only what the item states, never guesses. owner_agreed: the owner said yes / agreed to talk.
- seen: for each of channel, year, first contact, interview and company, whether the item shows it or you inferred it.
  seen.agreement: "shown" when the owner's own reply says yes / agrees to a call / books one (then owner_agreed is true); "declined" when the owner said no or not interested; "none" when the owner hasn't replied; "unclear" when the owner replied but it isn't clear whether they agreed to talk (e.g. only asked a question). Otherwise owner_agreed is false.
  Dates without a visible year: fill the ISO fields with your best reading but set seen.year "missing".
- last_message: the last visible message of the conversation (for an email: that email): who wrote it (the owner = \
"you"), its day and time exactly as written (a chat's day divider such as "MONDAY" or "TODAY" above it, plus its time), \
and its first words.
The owner's own messages may be in the screenshot; the other person is the recruiter or employer."""


def candidates(tracker):
    """Jobs Notion knows: tracked applications first, then open Job Matches (Tracker.notion_jobs)."""
    jobs = [j for j in tracker.notion_jobs() if j.get('stage') not in ('Dismissed', 'Closed')
            and (j.get('stage') or j.get('match_status') not in GONE)]
    jobs.sort(key=lambda j: (not j.get('stage'), -(j.get('fit') or 0)))
    return jobs[:MAX_JOBS]


def listing(jobs):
    return '\n'.join(f"{i}. {j.get('company') or '(employer not named)'} — {j.get('title') or '?'}"
                     f"{' · ' + j['location'] if j.get('location') else ''}"
                     f"{' · via ' + j['via'] if j.get('via') else ''}{' · recruiter ' + j['contact'] if j.get('contact') else ''}"
                     f" [{j.get('stage') or 'open job, not applied'}]" for i, j in enumerate(jobs))


def _words(text):
    return set(re.findall(r'[a-z0-9]+', (text or '').lower())) - {'senior', 'sr', 'the', 'and', 'of', 'a', 'engineer', 'remote'}


def _who(jobs, item):
    """For each tracked job: (index, same recruiter (name or email), same company/agency) as the item."""
    people = {p.lower() for p in (item.get('recruiter_name'), item.get('recruiter_email')) if p}
    orgs = {o.lower() for o in (item.get('company'), item.get('recruiter_company')) if o}
    for i, job in enumerate(jobs):
        if job.get('stage'):
            who = (job.get('contact') or '').lower()
            yield i, any(p in who for p in people), bool(orgs & ({(job.get('company') or '').lower(), (job.get('via') or '').lower()} - {''}))


def same_job(jobs, item):
    """A tracked job this item is plainly about when Claude found none: the same recruiter (name or email) or the
    same company/agency, and the same role words. Pasting one pitch twice (even a new screenshot of it) lands here."""
    role = _words(item.get('role') or item.get('title'))
    for i, same_person, same_org in _who(jobs, item):
        title = _words(jobs[i].get('title'))
        same_role = bool(role and title) and (role <= title or title <= role or len(role & title) >= 2)
        if (same_person or same_org) and (same_role or (same_person and not role)):
            return i
    return -1


def related(jobs, item):
    """Tracked jobs from the same recruiter or company/agency as the item (same_job's first test, whatever the role):
    the candidates for "Which job is this?" when Claude found none."""
    return [i for i, same_person, same_org in _who(jobs, item) if same_person or same_org]


def _job_choice(job):
    return {'url': job['url'], 'stage': job.get('stage') or '',
            'label': ' · '.join(p for p in (job.get('company') or job.get('via') or '—', job.get('title') or '?') if p)}


MAX_IMAGES = 5  # screenshots per log: a long LinkedIn chat takes a few


def images_of(image):
    """One screenshot, several, or none, as a list of (name, bytes, media type)."""
    return list(image[:MAX_IMAGES]) if isinstance(image, list) else ([image] if image else [])


def read(client, model, text, image, jobs, stats=None):
    """Claude's reading: a dict with SCHEMA's fields. image = (name, bytes, media type), a list of them, or None
    (several screenshots of one conversation are read together, in order)."""
    content = []
    for shot in images_of(image):
        content.append({'type': 'image', 'source': {'type': 'base64', 'media_type': shot[2],
                                                     'data': base64.b64encode(shot[1]).decode()}})
    content.append({'type': 'text', 'text': (text[:8000] if text else '(see the screenshots)' if len(content) > 1 else '(see the screenshot)')})
    response = client.messages.create(
        model=model, max_tokens=1200,
        system=[{'type': 'text', 'text': SYSTEM + '\n\nJobs:\n' + (listing(jobs) or '(none)'),
                 'cache_control': {'type': 'ephemeral'}}],  # several pastes in a row read the job list once
        messages=[{'role': 'user', 'content': content}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}},
    )
    cost.add(stats, model, response.usage)
    return json.loads(next(b.text for b in response.content if b.type == 'text'))


def _image_blocks(tracker, image):
    """The screenshots as Notion image blocks (uploaded); one that fails to upload is left out."""
    blocks, shots = [], images_of(image)
    for number, shot in enumerate(shots, 1):
        step(f"Saving screenshot {number} of {len(shots)} on the job's Notion page" if len(shots) > 1
             else "Saving the screenshot on the job's Notion page")
        try:
            upload = tracker.upload_file(shot[0], shot[1], shot[2])
        except Exception as error:  # noqa: BLE001 — the update matters more than the picture
            print(f'Warning: screenshot not uploaded to Notion: {type(error).__name__}: {error}', file=sys.stderr)
            continue
        blocks.append({'object': 'block', 'type': 'image', 'image': {'type': 'file_upload', 'file_upload': {'id': upload}}})
    return blocks


def _thumbnails(blocks):
    """Screenshots side by side in columns: small on the page, full size in Notion's viewer when clicked."""
    if len(blocks) < 2:
        return blocks
    return [{'object': 'block', 'type': 'column_list', 'column_list': {'children': [
        {'object': 'block', 'type': 'column', 'column': {'children': [block]}} for block in blocks]}}]


def _keep(tracker, row, text, image, summary, when, platform=None, check=(), changes=()):
    """What was logged, on the job's page: one folded entry per log ("📥 29 Sep · what it said"), with the message
    inside and the screenshots as a row of thumbnails, so the page stays readable however many you log."""
    try:
        day = datetime.fromisoformat(when.replace('Z', '+00:00')).strftime('%d %b %Y')
    except ValueError:
        day = when[:10]
    if platform and _platform_named(summary) != platform:
        summary = f'{platform} · {summary}'  # the entry says where it came from
    inside = [_block('quote', part) for part in re.split(r'\n\s*\n', text.strip())[:40] if part.strip()] if text else []
    head = []
    if check:  # logged without your confirmation (Telegram): what to check, on the page itself
        head.append(_block('paragraph', f"⚠️ Check these details: {'; '.join(check)}."))
    if changes:  # a value this log replaced, before → after: a job's big changes leave a trail
        head.append(_block('paragraph', f"Changed: {'; '.join(changes)}"))
    inside = head + inside
    shots = _image_blocks(tracker, image)
    if len(shots) < 2:
        inside += shots
    entry = {'object': 'block', 'type': 'toggle', 'toggle': {
        'rich_text': [{'type': 'text', 'text': {'content': f'📥 {day} · {summary}'[:1900]}, 'annotations': {'bold': True}}],
        'children': inside or [_block('paragraph', summary)]}}
    try:
        added = tracker.append_blocks(row['id'], [entry])
        if len(shots) > 1:  # columns inside the fold: a second call (Notion nests only two levels per call)
            toggle = ((added or {}).get('results') or [{}])[0].get('id')
            if toggle:
                tracker.append_blocks(toggle, _thumbnails(shots))
    except Exception as error:  # noqa: BLE001
        print(f'Warning: not copied to the page: {type(error).__name__}: {error}', file=sys.stderr)


def _channel_named(item):
    """What a log entry names as its channel: a known one (LinkedIn, Email, a confirmed Phone), or what you typed
    for Other (WhatsApp); None when unknown (then the entry says nothing about it)."""
    platform = item.get('platform')
    if platform == 'Other':
        return item.get('channel_other') or None
    return platform if platform in opportunity.CHANNEL_SOURCE else None


def _day(value):
    try:
        return date.fromisoformat((value or '')[:10])
    except ValueError:
        return None


def _new_row(tracker, item, url, source, event_source, when, note):
    """A role not known anywhere, applied elsewhere: Applications row at Applied (date approximate) + its event."""
    props = opportunity.properties(item, url, APPLIED, source, origin='Logged from a paste')
    props['Recruiter'] = {'checkbox': bool(item.get('recruiter_name')) and not item.get('in_house')}
    if not item.get('recruiter_name'):
        props['Channel'] = {'select': {'name': 'Direct'}}
    day = _day(when)
    if day:
        props.update({'Applied on': {'date': {'start': day.isoformat()}}, 'Date approximate': {'checkbox': True}})
    # Applied elsewhere: you went after it (Outbound, src/notion/origin.py).
    row = tracker.create_page(tracker.database_id, origin_rule.stamp(props, origin_rule.OUTBOUND))
    known = row.setdefault('properties', {})
    for name, value in (('Company', {'rich_text': [{'plain_text': item.get('company') or ''}]}),
                        ('Job', {'title': [{'plain_text': opportunity.title(item)}]}), ('Job URL', {'url': url}),
                        ('Stage', {'select': {'name': APPLIED}})):
        known.setdefault(name, value)
    add_event(tracker, row, APPLIED, event_source, at=day.isoformat() if day else None,
              note=f'Applied outside Job Pilotto; {note} (date is an upper bound)'[:300])
    return row


def _row_for(tracker, url):
    row = tracker.find(url)
    if row is not None:
        row.setdefault('url', '')
    return row


GAPS = {'Company': 'company', 'Location': 'location', 'Salary': 'salary'}
DESCRIPTION_HEADING = '🧾 Job description'  # on the job's page: what messages and screenshots said about the role
MIN_ABOUT = 80


def _fill_gaps(tracker, row, item, report=None):
    """What a job was missing (the employer behind an agency's invitation, where, the pay) from the pasted message.
    Only empty fields are filled: nothing you or an earlier message wrote is replaced. And where you first talked:
    a conversation (e.g. a LinkedIn chat) that began before the job was tracked (e.g. from the later email invite)
    becomes its Reached via. Returns what was filled. report: a list that gets each value this replaced, "Source Manual
    → LinkedIn" (for the reply and the job's page). And who reached out first, when you answered it: "they did" makes
    a job whose conversation began before its first contact Inbound (src/notion/origin.py); nothing else does."""
    changes = {name: {'rich_text': [{'text': {'content': str(item[key])[:200]}}]}
               for name, key in GAPS.items() if item.get(key) and not plain(row['properties'].get(name))}
    # A job known only from an invitation ("SRE"): the fuller title the message gives ("Principal SRE"), when it
    # contains the one there (never a different role).
    props = row['properties']
    title, current = (item.get('role') or item.get('title') or '').strip(), plain(props.get('Job')) or ''
    company, via = plain(props.get('Company')) or '', plain(props.get('Via')) or ''
    role = titles.role_of(current, company, via)
    words = lambda text: set(re.findall(r'[a-z0-9]+', text.lower()))
    fuller = title if title and role and len(title) > len(role) and words(role) <= words(title) else ''
    if origin_rule.row_origin(row) == origin_rule.INBOUND:
        # It found you: its title names who it is for, now the employer is known ("Principal SRE · Acme"), unless
        # you edited it (src/notion/titles.py).
        known = changes['Company']['rich_text'][0]['text']['content'] if 'Company' in changes else company
        new = titles.retitled(current, known, via, was=(company, via), role=fuller or None)
        if new:
            changes['Job'] = titles.title_property(new)
    elif fuller:
        changes['Job'] = titles.title_property(fuller)
    platform = item.get('platform')
    began = mail._when(item.get('first_contact') or '') or mail._when(item.get('when') or '')
    tracked = mail._when(row.get('created_time') or '')
    if began and tracked and began < tracked:  # before the row was tracked: was it before its first contact too?
        first = _origin(tracker, row)
        changes.update(opportunity.first_contact_changes(row, platform, began, first))
        if item.get('origin_answer') == origin_rule.INBOUND and first and began < first \
                and origin_rule.row_origin(row) == origin_rule.OUTBOUND:
            changes['Origin'] = {'select': {'name': origin_rule.LABELS[origin_rule.INBOUND]}}
    if report is not None:
        for name in ('Origin', 'Source', 'Reached via'):
            was = plain(row['properties'].get(name)) or (origin_rule.LABELS[origin_rule.row_origin(row)] if name == 'Origin' else '')
            if name in changes and was and was != changes[name]['select']['name']:
                report.append(f"{name} {was} → {changes[name]['select']['name']}")
    if changes:
        tracker.update_page(row['id'], changes)
        for name, value in changes.items():
            row['properties'][name] = ({'type': 'select', 'select': value['select']} if 'select' in value else
                                       {'type': 'title', 'title': [{'plain_text': value['title'][0]['text']['content']}]} if 'title' in value else
                                       {'type': 'rich_text', 'rich_text': [{'plain_text': value['rich_text'][0]['text']['content']}]})
    named = {'Job': f'the title "{title}"'} if fuller else {}
    filled = [GAPS.get(name) or named[name] for name in changes if name in GAPS or name in named]
    return filled + ([f'first contact on {platform}'] if set(changes) & FIRST_CONTACT else [])


FIRST_CONTACT = {'Source', 'Reached via', 'Notes'}


def _origin(tracker, row):
    """When the row's first contact happened: the earliest of its creation, its events from the same Source
    (e.g. the Gmail check's events carry the email's date; logged pastes carry their own) and its "Recruiter lead"
    event (a job tracked from a paste is dated when the conversation began, as you confirmed it in the app)."""
    moments = [mail._when(row.get('created_time') or '')]
    source = plain(row['properties'].get('Source'))
    if ledger.EVENTS_DATABASE_ID and hasattr(tracker, 'query_database'):
        # By the Application relation only: the Source and Kind are compared here. The row's Source ("Manual",
        # "Telegram") need not be an option of the events' Source, and Notion answers 400 to a select filter on a
        # value its column doesn't have (30 Sep 2026: "events not read: HTTP Error 400").
        try:
            events = tracker.query_database(ledger.EVENTS_DATABASE_ID, {'property': 'Application', 'relation': {'contains': row['id']}})
        except Exception as error:  # noqa: BLE001 — the row's creation time still tells
            print(f'Warning: events not read: {type(error).__name__}: {error}', file=sys.stderr)
            events = []
        events = [e for e in events if plain(e['properties'].get('Kind')) == opportunity.LEAD_STAGE
                  or (source and plain(e['properties'].get('Source')) == source)]
        moments += [mail._when(plain(e['properties'].get('At')) or '') for e in events]
    moments = [m for m in moments if m]
    return min(moments) if moments else None


def _platform_named(text):
    lower = (text or '').lower()
    if lower.startswith('phone · '):  # a call you confirmed ("Phone · …"); "call" in a summary alone isn't one
        return 'Phone'
    return 'LinkedIn' if 'linkedin' in lower else 'Email' if re.search(r'\b(e-?mail|gmail)\b', lower) else None


def _this_year(value, now):
    """Chats show "Sep 21" without a year and the model guesses one (2024 on 29 Sep 2026): a date more than
    ~6 months back is moved to the latest year it could be, never into the future."""
    moment = mail._when(value or '')
    if not moment or (now - moment).days < 180:
        return value
    for year in (now.year, now.year - 1):
        try:
            moved = moment.replace(year=year)
        except ValueError:  # 29 Feb
            continue
        if moved <= now:
            return moved.isoformat()
    return value


def step(text):
    """A progress line for the app's Log box ("⏳ …", on stderr; the app shows the latest with a timer)."""
    print(f'⏳ {text}', file=sys.stderr, flush=True)


CHANNELS = ('LinkedIn', 'Email', 'Phone', 'Other')  # the app's "Where is this conversation from?"


def _client(client):
    if client is not None:
        return client
    if not os.getenv('ANTHROPIC_API_KEY'):
        raise ValueError('Reading a message needs your Anthropic API key (Settings → AI).')
    import anthropic
    return anthropic.Anthropic()


def _as_written(text):
    return f' "{text.strip()[:40]}"' if (text or '').strip() else ''


def _years(value, now):
    """The years a date shown without one could be (never in the future): this year first, then last year."""
    moment = mail._when(value or '')
    years = []
    for year in (now.year, now.year - 1):
        try:
            if not moment or moment.replace(year=year) <= now:
                years.append(year)
        except ValueError:  # 29 Feb
            continue
    return years


WEEKDAYS = {'monday': 0, 'mon': 0, 'tuesday': 1, 'tues': 1, 'tue': 1, 'wednesday': 2, 'wed': 2, 'thursday': 3,
            'thurs': 3, 'thur': 3, 'thu': 3, 'friday': 4, 'fri': 4, 'saturday': 5, 'sat': 5, 'sunday': 6, 'sun': 6}
MONTHS = {name: number for number, names in enumerate(
    (('jan', 'january'), ('feb', 'february'), ('mar', 'march'), ('apr', 'april'), ('may',), ('jun', 'june'),
     ('jul', 'july'), ('aug', 'august'), ('sep', 'sept', 'september'), ('oct', 'october'), ('nov', 'november'),
     ('dec', 'december')), 1) for name in names}
MONTH_DAY_DAYS = 7  # "Sep 28" without a year: read only when it can only be this last week (else the year is asked)


def resolve_day(text, today):
    """A day and time as a chat or mail app writes them ("MONDAY 12:33 AM", "Today", "Yesterday 14:02", "Sep 28",
    "28 Sep 2026", "2026-09-28"), resolved against `today` (the day it's logged). Pure, never guesses:
    - TODAY / YESTERDAY; a weekday name = the most recent such day, not after today (today itself included);
    - a full date with its year = that date, as written (a numeric one only when day and month can't be swapped);
    - a month and day without the year = the most recent such day, only within MONTH_DAY_DAYS (else unknown).
    Returns {'date': date or None, 'time': 'HH:MM' or '', 'how': 'relative'|'full'|'month_day'|''}."""
    low = re.sub(r'\s+', ' ', (text or '').lower()).strip()
    out = {'date': None, 'time': '', 'how': ''}
    if not low:
        return out
    clock = re.search(r'\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s?m\b\.?', low) or re.search(r'\b(\d{1,2}):(\d{2})\b', low)
    if clock:
        hour, minute = int(clock.group(1)), int(clock.group(2) or 0)
        if clock.lastindex == 3 and clock.group(3):
            hour = hour % 12 + (12 if clock.group(3) == 'p' else 0)
        if hour < 24 and minute < 60:
            out['time'] = f'{hour:02d}:{minute:02d}'
        low = (low[:clock.start()] + ' ' + low[clock.end():]).strip()

    def day(year, month, number):
        try:
            return date(year, month, number)
        except ValueError:
            return None

    def done(found, how):
        if found and found <= today:
            out.update(date=found, how=how)
        return out

    if found := re.search(r'\b(\d{4})-(\d{1,2})-(\d{1,2})\b', low):
        return done(day(int(found.group(1)), int(found.group(2)), int(found.group(3))), 'full')
    if found := re.search(r'\b(\d{1,2})([./])(\d{1,2})\2(\d{4}|\d{2})\b', low):
        first, second, year = int(found.group(1)), int(found.group(3)), int(found.group(4))
        year += 2000 if year < 100 else 0
        if found.group(2) == '.' or first > 12:  # 28.09.2026 (day first), 28/09/2026
            return done(day(year, second, first), 'full')
        if second > 12:  # 9/28/2026
            return done(day(year, first, second), 'full')
        return out if first != second else done(day(year, first, second), 'full')  # 03/04/2026: which is the month?
    month_words = '|'.join(sorted(MONTHS, key=len, reverse=True))
    written = (re.search(rf'\b(\d{{1,2}})(?:st|nd|rd|th)?\.? ({month_words})\b\.?,?(?: (\d{{4}}))?', low)
               or re.search(rf'\b({month_words})\b\.? (\d{{1,2}})(?:st|nd|rd|th)?\b,?(?: (\d{{4}}))?', low))
    if written:
        number, month = (written.group(1), written.group(2)) if written.group(1).isdigit() else (written.group(2), written.group(1))
        number, month = int(number), MONTHS[month]
        if written.group(3):
            return done(day(int(written.group(3)), month, number), 'full')
        found = day(today.year, month, number)
        if found and found > today:
            found = day(today.year - 1, month, number)
        out['how'] = 'month_day'
        return done(found, 'month_day') if found and (today - found).days <= MONTH_DAY_DAYS else out
    if re.search(r'\btoday\b', low):
        return done(today, 'relative')
    if re.search(r'\byesterday\b', low):
        return done(today - timedelta(days=1), 'relative')
    if found := re.search(rf"\b({'|'.join(sorted(WEEKDAYS, key=len, reverse=True))})\b", low):
        return done(today - timedelta(days=(today.weekday() - WEEKDAYS[found.group(1)]) % 7), 'relative')
    return out


def resolve_at(text, today, tz=None):
    """resolve_day() as an ISO moment in the owner's time zone ("2026-09-28T00:33:00+02:00"), a day ("2026-09-28")
    when no time is written, or '' when the day can't be told."""
    found = resolve_day(text, today)
    if not found['date']:
        return ''
    if not found['time']:
        return found['date'].isoformat()
    hour, minute = map(int, found['time'].split(':'))
    return datetime.combine(found['date'], datetime.min.time().replace(hour=hour, minute=minute), tz or mail.TZ).isoformat()


def _resolve_dates(item, now):
    """Dates the item writes as a chat does ("MONDAY"), resolved against the day it's logged: the last message's
    moment (item['last_message']['resolved'], '' = ask) and, when the first message's day is written that way, the
    conversation's start (item['first_contact'], flagged first_contact_resolved: no year question)."""
    today = now.astimezone(mail.TZ).date()
    started = resolve_day(item.get('first_contact_text'), today)
    if started['date']:
        item['first_contact'] = resolve_at(item.get('first_contact_text'), today) if started['time'] \
            else f"{started['date'].isoformat()}T12:00:00+00:00"
        item['first_contact_resolved'] = True
    last = dict(item.get('last_message') or {})
    if last.get('from') in ('you', 'them'):
        moment = resolve_at(last.get('at_text'), today)
        if not moment and (item.get('seen') or {}).get('year') == 'shown' and mail._when(last.get('at') or '') \
                and mail._when(last['at']) <= now:
            moment = last['at']  # a full date with its year, read from the item
        last['resolved'] = moment
        last['text_snippet'] = re.sub(r'\s+', ' ', last.get('text_snippet') or '').strip()[:120]
        item['last_message'] = last
    return item


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


def _tracked_state(tracker, job):
    """A tracked job's row as it is now (Origin, Source, Reached via, Stage: what a log may change, for the "This will
    change" box) and when its first contact was known to be ({} and None when it has no row)."""
    row = _row_for(tracker, job['url']) if job and job.get('stage') else None
    if row is None:
        return {}, None
    props = row['properties']
    label = plain(props.get('Origin')) or origin_rule.LABELS[origin_rule.row_origin(row)]
    return ({'Origin': label, 'Source': plain(props.get('Source')) or '', 'Reached via': plain(props.get('Reached via')) or '',
             'Stage': plain(props.get('Stage')) or ''}, _origin(tracker, row))


def _asks_origin(item, current, first_known):
    """Who reached out first is asked for a tracked Outbound job when the conversation may predate its first contact:
    it began before it, or the day isn't known yet (the window asks only once the day you confirm is earlier)."""
    if not current or first_known is None or origin_rule.stored(current.get('Origin')) != origin_rule.OUTBOUND:
        return False
    began = mail._when(item.get('first_contact') or '') or mail._when(item.get('when') or '')
    return began is None or began < first_known or (item.get('seen') or {}).get('year') == 'missing'


def propose(tracker, *, text='', image=None, client=None, model=DEFAULT_MODEL, stats=None, now=None, target='', item=None):
    """Step 1 of a log, nothing written to Notion: Claude reads the message once and it's matched to a job. Returns
    the proposal the app shows for confirming and hands back to log(): {item, job, kind, new, label, stage, fields}
    (fields: see fields()). Raises ValueError for what can't be logged at all.
    item: an earlier proposal's reading, for the job you picked in the confirmation step (target): no second reading.
    When Claude found no job and several tracked ones are from the same recruiter or company (or one is, but not
    plainly the same role), fields['job'] asks "Which job is this?" with them as candidates."""
    now = now or datetime.now(timezone.utc)
    if item is None:
        text = (text or '').strip()
        if not image and len(text) < opportunity.MIN_TEXT:
            raise ValueError('Paste the whole message or a screenshot of it, not just a line.')
        client = _client(client)
        step('Reading your jobs in Notion')
        jobs = candidates(tracker)
        shots = len(images_of(image))
        step(f"Claude is reading {shots} screenshots" if shots > 1 else 'Claude is reading the screenshot' if shots
             else 'Claude is reading the message')
        item = read(client, model, text, image, jobs, stats)
    else:
        step('Reading your jobs in Notion')
        jobs = candidates(tracker)
    kind = item['kind']
    if kind == NOT_JOB and target:  # you said which job it's about: log it as a reply there
        kind = REPLY
    if kind == NOT_JOB and not target:
        raise ValueError("That doesn't look like a message about a job, so nothing was logged.")
    match = item.get('match', -1)
    if target == 'new':
        match = -1
    elif target:
        match = next((i for i, j in enumerate(jobs) if j['url'] == target), -1)
        if match < 0:
            raise ValueError('That job is no longer in your Notion; pick it again, or choose "A new job".')
    unsure = []
    if not target and not 0 <= match < len(jobs):
        match = same_job(jobs, item)
        near = related(jobs, item)
        if len(near) >= 2 or (near and match < 0):
            unsure = near
    job = jobs[match] if 0 <= match < len(jobs) else None
    new = not (job and job.get('stage'))
    stage = (job or {}).get('stage') or ''
    if not new and stage not in EARLY and (kind == OUTREACH or (kind == APPLIED and stage != opportunity.LEAD_STAGE)):
        kind = UPDATE  # a first contact (or an application) for a job you're already past: nothing of that kind is new
    _resolve_dates(item, now)
    shown = job or dict(item, title=item.get('role') or item.get('title'))
    current, first_known = _tracked_state(tracker, job) if not new else ({}, None)
    found = fields(item, kind, new=new, now=now, stage=stage, first_known=first_known, current=current)
    if unsure:  # asked first; the other details follow the job you pick (proposed again for it)
        found = {'job': {'value': '', 'state': 'ask', 'question': 'Which job is this?',
                         'candidates': [_job_choice(jobs[i]) for i in unsure]}, **found}
    return {'item': item, 'job': job, 'kind': kind, 'new': new, 'stage': stage, 'target': target, 'current': current,
            'first_known': first_known.isoformat() if first_known else '',
            'label': ' — '.join(p for p in (shown.get('company') or shown.get('recruiter_company'), opportunity.title(shown)) if p),
            'fields': found}


def confirm(proposal, *, kind='', channel='', other='', started='', interview_at='', company=None, agency=None,
            first_contact=None, last_at='', agreed=None, origin=None):
    """The proposal with what you confirmed in the app in place of Claude's readings: kind, channel (LinkedIn, Email,
    Phone, Other; other = what "Other" was, e.g. WhatsApp), started (YYYY-MM-DD, when the conversation began),
    interview_at (YYYY-MM-DDTHH:MM), company / agency (a new job's), for a new job whether this was the first
    contact about it (then its Source follows the channel), and last_at (YYYY-MM-DD[THH:MM]): the day of the last
    message when it couldn't be read (its time, when read, is kept for the same day), and agreed: your answer to
    "Did you agree to talk to the recruiter?" (True moves a new job or a Recruiter lead to Screening)."""
    if ((proposal.get('fields') or {}).get('job') or {}).get('state') == 'ask':
        raise ValueError('Say which job this is first.')  # the app proposes again for the job you pick
    item = dict(proposal['item'])
    if last_at:
        day = _day(last_at)
        if not day:
            raise ValueError(f'Not a date: "{last_at}" (YYYY-MM-DD).')
        last = dict(item.get('last_message') or {})
        if (last.get('resolved') or '')[:10] != day.isoformat():
            moment = mail._when(last_at) if len(last_at) > 10 else None
            last['resolved'] = moment.isoformat() if moment else day.isoformat()
        item['last_message'] = last
    if kind:
        if kind not in KINDS + [UPDATE] or kind == NOT_JOB:
            raise ValueError(f'Unknown kind "{kind}".')
    if channel:
        if channel not in CHANNELS:
            raise ValueError(f'Unknown channel "{channel}" (LinkedIn, Email, Phone or Other).')
        item['platform'] = channel
        item['channel_other'] = (other or '').strip()[:40] if channel == 'Other' else ''
    if started:
        day = _day(started)
        if not day:
            raise ValueError(f'Not a date: "{started}" (YYYY-MM-DD).')
        item['first_contact'] = f'{day.isoformat()}T12:00:00+00:00'
        if (item.get('seen') or {}).get('year') == 'missing' and mail._when(item.get('when') or ''):
            item['when'] = _in_year(item['when'], day)  # the message's own date: the year you gave
    if interview_at:
        if not mail._when(interview_at):
            raise ValueError(f'Not a date and time: "{interview_at}".')
        item['interview_at'] = interview_at
    elif (item.get('seen') or {}).get('interview') in ('partial',) or (item.get('seen') or {}).get('year') == 'missing':
        item['interview_at'] = ''  # never a guessed time
    if company is not None:
        item['company'] = company.strip()[:200]
    if agency is not None:
        item['recruiter_company'] = agency.strip()[:200]
        item['in_house'] = item.get('in_house') and not agency.strip()
    if first_contact is not None:
        item['first_contact_here'] = bool(first_contact)
    if agreed is not None:
        item['agreed'] = bool(agreed)
    if origin:
        if not origin_rule.stored(origin):
            raise ValueError(f'Unknown origin "{origin}" (inbound or outbound).')
        item['origin_answer'] = origin_rule.stored(origin)  # who reached out first: they did = inbound
    return {**proposal, 'item': item, 'kind': kind or proposal['kind'], 'confirmed': True}


def _in_year(value, start):
    """A year-less date read as ISO, moved to the year of the conversation's start (a day before it: the next year)."""
    moment = mail._when(value)
    try:
        moved = moment.replace(year=start.year)
        if moved.date() < start:
            moved = moved.replace(year=start.year + 1)
    except ValueError:
        return value
    return moved.isoformat()


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


def log(tracker, *, text='', image=None, client=None, model=DEFAULT_MODEL, talking=False, source='Manual',
        event_source='CLI', stats=None, now=None, target='', on_new=None, proposal=None, found=None):
    """Read one pasted message or screenshot, update or create the job it's about. Returns one line for the reply.
    target: '' = Claude decides which job; 'new' = a new job; a job URL = that job (the app's "Which job?").
    proposal: propose()'s result (confirmed with confirm()): no second reading; without it Claude's guesses stand
    (Telegram, the terminal).
    on_new(url, job, row): called for a job tracked here for the first time (src/ai/added.hook: facts, fit score,
    Job Matches row, like a found job); returns a short line for the reply, or None.
    found: a dict that gets the job's row and whether it was created here, for the run's link to it."""
    text = (text or '').strip()
    now = now or datetime.now(timezone.utc)
    if proposal is None:
        proposal = propose(tracker, text=text, image=image, client=client, model=model, stats=stats, now=now, target=target)
    item, job, kind = dict(proposal['item']), proposal['job'], proposal['kind']
    check = [] if proposal.get('confirmed') else unchecked(item, kind)
    if not proposal.get('confirmed') and ((proposal.get('fields') or {}).get('job') or {}).get('state') == 'ask':
        check.append(f"which job it is ({len(proposal['fields']['job']['candidates'])} possible)")
    if not proposal.get('confirmed'):  # nobody confirmed the dates: a year-less one is this year's (and flagged)
        for key in ('when', 'first_contact'):
            if mail._when(item.get(key) or ''):
                item[key] = _this_year(item[key], now)
    step(f"Claude found: {kind}{' · ' + (item.get('role') or item.get('title')) if (item.get('role') or item.get('title')) else ''}"
         " — updating the job in Notion")
    # Screening when you said yes: the explicit --talking (Telegram, the terminal), your answer in the app, or the
    # conversation showing it; an unanswered 'unclear' moves nothing (Telegram says to check it).
    talking = talking or agreed(item)
    item['owner_agreed'] = talking  # opportunity.track reads it too: never a yes you didn't give
    if not (talking or proposal.get('confirmed')) and agreement(item) == 'unclear' \
            and agree_applies(proposal.get('new', True), proposal.get('stage') or ''):
        check.append('whether you agreed to talk to the recruiter (not moved to Screening)')
    seed = hashlib.sha256(re.sub(r'\s+', ' ', text).lower().encode() + b''.join(s[1] for s in images_of(image))).hexdigest()[:16]
    source_id = f'paste:{seed}'
    when = item['when'] if mail._when(item.get('when') or '') else now.isoformat(timespec='seconds')
    if item.get('interview_at') and not ledger.plausible_interview(item['interview_at'], when):
        check.append(f"call date {item['interview_at'][:10]} impossible for this message: not saved")
        item['interview_at'] = ''
    first_here = item.get('first_contact_here')
    # A new job's first contact: its first event is dated when the conversation began, so a later contact logged
    # from another channel can't take its Source (the earliest-contact rule reads the events' dates).
    began = item['first_contact'] if first_here and mail._when(item.get('first_contact') or '') else None
    summary = item.get('summary') or kind
    row = _row_for(tracker, job['url']) if job and job.get('stage') else None
    if kind == UPDATE and row is None:  # "Update on this job" is for a tracked one; anything else is their reply
        kind = REPLY

    if row is None and kind == OUTREACH:  # a recruiter's pitch: an open job it names, or a new lead
        lead = dict(item, job_url=job['url'], company=job.get('company') or item.get('company'),
                    title=job.get('title') or item.get('title')) if job else item
        row, line = opportunity.track(tracker, lead, text, source=source, event_source=event_source, talking=talking,
                                      at=began or when, seed=seed, extra_blocks=([_block('paragraph', f"⚠️ Check these details: {'; '.join(check)}.")] if check else [])
                                      + _image_blocks(tracker, image),
                                      note=f'Logged: {summary}'[:300])
        if not row:
            return 'ℹ️ ' + line
        if found is not None:
            found.update(row=row, created=True)
        fit = _rich(on_new, row, lead, text)
        noted = _last_message(tracker, row, item, event_source, kind)
        return '🤝 ' + line + (f' · {fit}' if fit else '') + (f' {noted}' if noted else '') + _check_line(check)

    created = False
    if row is None and job:  # an open job, not tracked yet
        day = _day(when) if kind == APPLIED else None
        # You said this was the first contact (a LinkedIn message, a call): its channel decides (src/notion/origin.py).
        first = origin_rule.origin(source=opportunity.source_for(item, source)) if first_here else None
        ledger.add_application(tracker, job['url'], applied=day or now.date(), approx=kind != APPLIED, source=source,
                               meta={'title': job.get('title'), 'company': job.get('company'), 'location': job.get('location')},
                               origin=first)
        row, created = _row_for(tracker, job['url']), True
        if row is not None and first_here:  # you said this was the first contact: it's where the job came from
            where = {'Source': {'select': {'name': opportunity.source_for(item, source)}}}
            if item.get('platform') in opportunity.REACHED_VIA:
                where['Reached via'] = {'select': {'name': item['platform']}}
            tracker.update_page(row['id'], where)
    if row is None:  # a role nothing knows yet
        if not (item.get('company') or item.get('recruiter_company')) or not (item.get('role') or item.get('title')):
            raise ValueError(f"It reads as \"{kind}\", but I can't tell which company and role, so nothing was logged. "
                             'Add a line saying which job it is.')
        item = dict(item, title=item.get('role') or item.get('title'))
        url = opportunity.lead_url(item, text, seed=seed)
        row = _row_for(tracker, url) or _new_row(tracker, item, url, source, event_source, when, f'logged: {summary}')
        created = True

    if found is not None:
        found.update(row=row, created=created)
    stage, url = plain(row['properties'].get('Stage')), plain(row['properties'].get('Job URL'))
    changes = []  # what this log replaced on a tracked job: said in the reply and on the job's page
    filled = _fill_gaps(tracker, row, item, changes) if not created else []
    about = (item.get('job_description') or '').strip()
    if len(about) >= MIN_ABOUT:
        # What the message says about the role, kept as the job's description (the prep kit and fit score read it).
        step('Saving the job description on the job')
        try:
            tracker.replace_after_heading(row['id'], DESCRIPTION_HEADING, ledger.md_blocks(about))
            filled.append('the job description')
        except Exception as error:  # noqa: BLE001 — the update itself matters more
            print(f'Warning: job description not saved: {type(error).__name__}: {error}', file=sys.stderr)
        if not created and not (row['properties'].get('Fit score') or {}).get('number'):
            step('Scoring how well the job fits you')
            fit = _rich(on_new, row, {**item, 'summary': about}, about)
            if fit:
                filled.append(f'fit {fit}')
    label = mail._label(row)
    changed = None
    if kind == OUTREACH and stage not in EARLY:  # the same pitch again (a follow-up would read as a reply)
        if not (talking and stage == opportunity.LEAD_STAGE):
            noted = _last_message(tracker, row, item, event_source, kind)
            return f'ℹ️ Already tracked: {label} ({stage}). ' + (f'Nothing new about the job. {noted}' if noted else 'Nothing new to log.')
    elif kind == UPDATE:  # a job already tracked: only its gaps, its description and who wrote last
        pass
    elif kind == OUTREACH:
        tracker.update_page(row['id'], {'Stage': {'select': {'name': opportunity.LEAD_STAGE}}})
        add_event(tracker, row, opportunity.LEAD_STAGE, event_source, at=when, note=f'Logged: {summary}'[:300])
        changed = opportunity.LEAD_STAGE
    elif kind == APPLIED:
        if stage in EARLY or stage == opportunity.LEAD_STAGE:
            ledger.set_stage(tracker, url, APPLIED, event_source)
            changed = APPLIED
        elif created:
            changed = APPLIED
    else:
        index = mail._events_index(tracker)
        changed = mail.record(tracker, row, REPLY if kind == OUTREACH else kind, when, event_source, source_id,
                              f'Logged: {summary}'[:300], index, item.get('interview_at') or None, now,
                              feedback_text=(item.get('feedback') or '') if image else mail.verified_feedback(item.get('feedback'), text))
    if talking and (stage == opportunity.LEAD_STAGE or changed == opportunity.LEAD_STAGE):
        ledger.set_stage(tracker, url, 'Screening', event_source, note='You said yes to the recruiter')
        changed = 'Screening'
    noted = _last_message(tracker, row, item, event_source, kind)
    if changed and not created and stage:  # the stage the job really has now (a kind that moved nothing changes nothing)
        after = plain(((_row_for(tracker, url) or row)['properties']).get('Stage'))
        if after and after != stage:
            changes.append(f'Stage {stage} → {after}')
    said = f" Changed: {'; '.join(changes)}." if changes else ''
    if not changed and filled:
        _keep(tracker, row, text, image, summary, when, _channel_named(item), check, changes)
        return f"🧩 Updated: {label}: added {', '.join(filled)}.{said}{' ' + noted if noted else ''}{_check_line(check)}"
    if not changed and noted:
        _keep(tracker, row, text, image, summary, when, _channel_named(item), check, changes)
        return f'ℹ️ Already tracked: {label} ({stage}). Nothing new about the job. {noted}{said}{_check_line(check)}'
    if not changed:
        return f'ℹ️ Already tracked: {label} ({stage}). Nothing new to log.' if kind == UPDATE else f'ℹ️ Already logged: {label} ({stage})'
    _keep(tracker, row, text, image, summary, when, _channel_named(item), check, changes)
    fit = _rich(on_new, row, item, text) if created and not job else None  # an open job was scored by its search
    verb = 'Tracked' if created else 'Updated'
    return (f"{EMOJI.get(kind, '•')} {verb}: {label} → {changed}. {summary}" + (f' · {fit}' if fit else '')
            + (f" Added {', '.join(filled)}." if filled else '') + said + (f' {noted}' if noted else '') + _check_line(check))


# Kinds that are themselves a message from them: their last message needs no event of its own.
THEIRS = {OUTREACH, 'Confirmation received', REPLY, 'Interview scheduled', 'Rejected', 'Offer', mail.employer_feedback.RECEIVED}


def last_message_id(last):
    """The last message's fingerprint (Source ID): who, when, its first words. The same message logged again, from
    another screenshot or another day, is the same event."""
    words = re.sub(r'\s+', ' ', last.get('text_snippet') or '').strip().lower()[:120]
    return 'chat:' + hashlib.sha256(f"{last.get('from')}|{last.get('resolved')}|{words}".encode()).hexdigest()[:16]


def _last_message(tracker, row, item, source, kind):
    """Who wrote last in the conversation, as an event on the job (📈 Application Events, idempotent): yours =
    "Replied" (Focus recommends a follow-up when it stays unanswered), theirs = "Reply received" (Focus: reply),
    unless the log's own event already is their message. Nothing when the day is unknown (the app asks it). Returns
    the sentence for the reply, or '' when nothing new was saved."""
    last = item.get('last_message') or {}
    who, at = last.get('from'), last.get('resolved') or ''
    if who not in ('you', 'them') or not mail._when(at if 'T' in at else f'{at}T12:00:00') or (who == 'them' and kind in THEIRS):
        return ''
    snippet = re.sub(r'\s+', ' ', last.get('text_snippet') or '').strip()[:120]
    event = add_event(tracker, row, mail.YOU_REPLIED if who == 'you' else REPLY, source, at=at,
                      note=(f'You wrote: {snippet}' if who == 'you' else f'They wrote: {snippet}') if snippet else
                      ('Your last message' if who == 'you' else 'Their last message'),
                      source_id=last_message_id(last))
    if (event or {}).get('_existing'):
        return ''
    day = date.fromisoformat(at[:10])
    said = f'{day:%a} {day.day} {day:%b}'
    return (f'Your last message was on {said}: saved so Focus can remind you to follow up.' if who == 'you'
            else f'Their last message was on {said}, waiting for your answer: saved for Focus.')


def _check_line(check):
    return f" ⚠️ Check: {'; '.join(check)}." if check else ''


def _rich(on_new, row, item, text):
    """The AI stages for a job tracked here for the first time (see src/ai/added.py)."""
    if not on_new:
        return None
    url = plain(row['properties'].get('Job URL'))
    job = {'title': opportunity.title(item), 'company': item.get('company') or '', 'location': item.get('location') or '',
           'work_mode': item.get('work_mode') or '', 'description': added.description_of(item, text)}
    return on_new(url, job, row)


def load_image(path):
    """(name, bytes, media type) of a screenshot file, or None for anything that isn't an image."""
    media = MEDIA.get(Path(path).suffix.lower())
    return (Path(path).name, Path(path).read_bytes(), media) if media else None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--text-file', help='the message (default: stdin, unless --image is given)')
    parser.add_argument('--image', help='a screenshot (.png, .jpg, .webp, .gif)')
    parser.add_argument('--talking', action='store_true', help="you've already said yes to the recruiter")
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required (Keychain entry job-pilotto.notion.token, or export it)')
    text = open(args.text_file, encoding='utf-8').read() if args.text_file else ('' if args.image else sys.stdin.read())
    image = load_image(args.image) if args.image else None
    if args.image and not image:
        raise SystemExit(f'Not a screenshot: {args.image} (use .png, .jpg, .webp or .gif)')
    try:
        print(log(tracker, text=text, image=image, talking=args.talking))
    except ValueError as error:
        print(f'⚠️ {error}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
