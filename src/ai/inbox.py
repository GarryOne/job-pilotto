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
from datetime import date, datetime, timezone
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

# What the item shows outright vs what was inferred: the app asks about everything not shown (owner's rule, 30 Sep
# 2026: never guess what can't be seen; ask in the confirmation step).
SEEN = {
    'type': 'object', 'additionalProperties': False,
    'required': ['channel', 'year', 'first_contact', 'interview', 'company'],
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
    },
}

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['kind', 'match', 'role', 'when', 'first_contact', 'interview_at', 'feedback', 'job_description',
                 'seen', 'first_contact_text', 'interview_text']
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
        'first_contact_text': {'type': 'string', 'description': 'The earliest date exactly as written in the item ("Sep 21", "Mon 14:02", "21/09/2026"), else ""'},
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
  Dates without a visible year: fill the ISO fields with your best reading but set seen.year "missing".
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


def same_job(jobs, item):
    """A tracked job this item is plainly about when Claude found none: the same recruiter (name or email) or the
    same company/agency, and the same role words. Pasting one pitch twice (even a new screenshot of it) lands here."""
    role = _words(item.get('role') or item.get('title'))
    people = {p.lower() for p in (item.get('recruiter_name'), item.get('recruiter_email')) if p}
    orgs = {o.lower() for o in (item.get('company'), item.get('recruiter_company')) if o}
    for i, job in enumerate(jobs):
        if not job.get('stage'):
            continue
        who = (job.get('contact') or '').lower()
        same_person = any(p in who for p in people)
        same_org = bool(orgs & ({(job.get('company') or '').lower(), (job.get('via') or '').lower()} - {''}))
        title = _words(job.get('title'))
        same_role = bool(role and title) and (role <= title or title <= role or len(role & title) >= 2)
        if (same_person or same_org) and (same_role or (same_person and not role)):
            return i
    return -1


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


def _keep(tracker, row, text, image, summary, when, platform=None, check=()):
    """What was logged, on the job's page: one folded entry per log ("📥 29 Sep · what it said"), with the message
    inside and the screenshots as a row of thumbnails, so the page stays readable however many you log."""
    try:
        day = datetime.fromisoformat(when.replace('Z', '+00:00')).strftime('%d %b %Y')
    except ValueError:
        day = when[:10]
    if platform and _platform_named(summary) != platform:
        summary = f'{platform} · {summary}'  # the entry says where it came from (resync_source reads it)
    inside = [_block('quote', part) for part in re.split(r'\n\s*\n', text.strip())[:40] if part.strip()] if text else []
    if check:  # logged without your confirmation (Telegram): what to check, on the page itself
        inside.insert(0, _block('paragraph', f"⚠️ Check these details: {'; '.join(check)}."))
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


def _fill_gaps(tracker, row, item):
    """What a job was missing (the employer behind an agency's invitation, where, the pay) from the pasted message.
    Only empty fields are filled: nothing you or an earlier message wrote is replaced. And where you first talked:
    a conversation (e.g. a LinkedIn chat) that began before the job was tracked (e.g. from the later email invite)
    becomes its Reached via. Returns what was filled."""
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
        changes.update(opportunity.first_contact_changes(row, platform, began, _origin(tracker, row)))
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
        first = {'property': 'Kind', 'select': {'equals': opportunity.LEAD_STAGE}}
        try:
            events = tracker.query_database(ledger.EVENTS_DATABASE_ID, {'and': [
                {'property': 'Application', 'relation': {'contains': row['id']}},
                {'or': [{'property': 'Source', 'select': {'equals': source}}, first]} if source else first]})
        except Exception as error:  # noqa: BLE001 — the row's creation time still tells
            print(f'Warning: events not read: {type(error).__name__}: {error}', file=sys.stderr)
            events = []
        moments += [mail._when(plain(e['properties'].get('At')) or '') for e in events]
    moments = [m for m in moments if m]
    return min(moments) if moments else None


LOGGED = re.compile(r'^📥 (\d{1,2} \w{3} \d{4}) · (.*)$', re.S)


def _platform_named(text):
    lower = (text or '').lower()
    if lower.startswith('phone · '):  # a call you confirmed ("Phone · …"); "call" in a summary alone isn't one
        return 'Phone'
    return 'LinkedIn' if 'linkedin' in lower else 'Email' if re.search(r'\b(e-?mail|gmail)\b', lower) else None


def logged_contacts(blocks):
    """[(datetime, platform)] of the "📥 <day> · …" entries on a job's page that name their channel."""
    found = []
    for block in blocks:
        rich = (block.get(block.get('type')) or {}).get('rich_text') or []
        entry = LOGGED.match(''.join(t.get('plain_text', '') for t in rich).strip())
        if not entry:
            continue
        try:
            day = datetime.strptime(entry.group(1), '%d %b %Y').replace(hour=12, tzinfo=timezone.utc)
        except ValueError:
            continue
        platform = _platform_named(entry.group(2))
        if platform:
            found.append((day, platform))
    return sorted(found)


def resync_source(tracker, page_id):
    """Recompute a job's Source (and Reached via, and the Notes' "(Email)") from what is logged on its page: the
    earliest dated entry from another channel than the row's own, before its first contact, wins. Returns the changes."""
    row = tracker._request('GET', f'pages/{page_id}')
    contacts = logged_contacts(tracker._children(page_id))
    origin = _origin(tracker, row)
    for began, platform in contacts:
        changes = opportunity.first_contact_changes(row, platform, began, origin)
        if changes:
            tracker.update_page(row['id'], changes)
            return changes
    return {}


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


def fields(item, kind, *, new, now):
    """What the app's confirmation step asks, each field {value, state, question…}: state "ok" = shown in the item
    (pre-filled), "check" = inferred (pre-filled, marked "please check", to be confirmed), "ask" = not shown at all
    (left empty, with a question). Nothing is written before every required one is confirmed."""
    seen = item.get('seen') or {}
    platform = item.get('platform') if item.get('platform') in CHANNELS else ''
    channel_state = {'shown': 'ok', 'guessed': 'check'}.get(seen.get('channel'), 'ask' if not platform or platform == 'Other' else 'check')
    out = {
        'kind': {'value': kind, 'state': 'check', 'options': [k for k in KINDS if k != NOT_JOB]},
        'channel': {'value': platform if channel_state != 'ask' else '', 'state': channel_state,
                    'guess': platform, 'question': 'Where is this conversation from?'},
    }
    began = item.get('first_contact') if mail._when(item.get('first_contact') or '') else item.get('when') or ''
    written = item.get('first_contact_text') or ''
    if not mail._when(began):
        out['started'] = {'value': '', 'state': 'ask', 'question': 'When did it start?'}
    elif seen.get('year') == 'missing':
        # "Sep 21" in a chat: which year is asked, never assumed (it once became 21 Sep 2024).
        out['started'] = {'value': '', 'state': 'ask', 'month_day': began[5:10], 'years': _years(began, now),
                          'question': f'Which year was{_as_written(written) or " " + began[5:10]}?'}
    else:
        out['started'] = {'value': began[:10], 'state': 'ok' if seen.get('first_contact', 'shown') == 'shown' else 'check',
                          'question': 'When did it start?'}
    interview, when_text = seen.get('interview') or ('shown' if item.get('interview_at') else 'none'), item.get('interview_text') or ''
    if interview != 'none' or kind == 'Interview scheduled':
        full = interview == 'shown' and seen.get('year') != 'missing' and mail._when(item.get('interview_at') or '')
        out['interview'] = {'value': item['interview_at'][:16] if full else '', 'state': 'ok' if full else 'ask',
                            'required': kind == 'Interview scheduled',
                            'question': 'When is the call?', 'as_written': when_text.strip()[:40]}
    if new:
        company_state = {'shown': 'ok', 'guessed': 'check'}.get(seen.get('company'), 'ask')
        out['company'] = {'value': item.get('company') or '' if company_state != 'ask' else '', 'state': company_state,
                          'required': False, 'question': 'Which company is hiring?'}
        out['agency'] = {'value': '' if item.get('in_house') else item.get('recruiter_company') or '', 'state': 'ok',
                         'required': False, 'question': 'Agency (if a recruiter found you)'}
    return out


def propose(tracker, *, text='', image=None, client=None, model=DEFAULT_MODEL, stats=None, now=None, target=''):
    """Step 1 of a log, nothing written to Notion: Claude reads the message once and it's matched to a job. Returns
    the proposal the app shows for confirming and hands back to log(): {item, job, kind, new, label, stage, fields}
    (fields: see fields()). Raises ValueError for what can't be logged at all."""
    text = (text or '').strip()
    if not image and len(text) < opportunity.MIN_TEXT:
        raise ValueError('Paste the whole message or a screenshot of it, not just a line.')
    client = _client(client)
    now = now or datetime.now(timezone.utc)
    step('Reading your jobs in Notion')
    jobs = candidates(tracker)
    shots = len(images_of(image))
    step(f"Claude is reading {shots} screenshots" if shots > 1 else 'Claude is reading the screenshot' if shots
         else 'Claude is reading the message')
    item = read(client, model, text, image, jobs, stats)
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
    elif not 0 <= match < len(jobs):
        match = same_job(jobs, item)
    job = jobs[match] if 0 <= match < len(jobs) else None
    new = not (job and job.get('stage'))
    shown = job or dict(item, title=item.get('role') or item.get('title'))
    return {'item': item, 'job': job, 'kind': kind, 'new': new, 'stage': (job or {}).get('stage') or '',
            'label': ' — '.join(p for p in (shown.get('company') or shown.get('recruiter_company'), opportunity.title(shown)) if p),
            'fields': fields(item, kind, new=new, now=now)}


def confirm(proposal, *, kind='', channel='', other='', started='', interview_at='', company=None, agency=None,
            first_contact=None):
    """The proposal with what you confirmed in the app in place of Claude's readings: kind, channel (LinkedIn, Email,
    Phone, Other; other = what "Other" was, e.g. WhatsApp), started (YYYY-MM-DD, when the conversation began),
    interview_at (YYYY-MM-DDTHH:MM), company / agency (a new job's), and for a new job whether this was the first
    contact about it (then its Source follows the channel)."""
    item = dict(proposal['item'])
    if kind:
        if kind not in KINDS or kind == NOT_JOB:
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
    if seen.get('year') == 'missing' and (item.get('when') or item.get('first_contact')):
        notes.append(f"year assumed{_as_written(item.get('first_contact_text'))}")
    if seen.get('channel') != 'shown':
        notes.append(f"channel {item.get('platform') or 'unknown'} guessed")
    if seen.get('interview') == 'partial' and item.get('interview_at'):
        notes.append(f"call time guessed{_as_written(item.get('interview_text'))}")
    notes.append(f'kind "{kind}" read by Claude')
    return notes


def log(tracker, *, text='', image=None, client=None, model=DEFAULT_MODEL, talking=False, source='Manual',
        event_source='CLI', stats=None, now=None, target='', on_new=None, proposal=None):
    """Read one pasted message or screenshot, update or create the job it's about. Returns one line for the reply.
    target: '' = Claude decides which job; 'new' = a new job; a job URL = that job (the app's "Which job?").
    proposal: propose()'s result (confirmed with confirm()): no second reading; without it Claude's guesses stand
    (Telegram, the terminal).
    on_new(url, job, row): called for a job tracked here for the first time (src/ai/added.hook: facts, fit score,
    Job Matches row, like a found job); returns a short line for the reply, or None."""
    text = (text or '').strip()
    now = now or datetime.now(timezone.utc)
    if proposal is None:
        proposal = propose(tracker, text=text, image=image, client=client, model=model, stats=stats, now=now, target=target)
    item, job, kind = dict(proposal['item']), proposal['job'], proposal['kind']
    check = [] if proposal.get('confirmed') else unchecked(item, kind)
    if not proposal.get('confirmed'):  # nobody confirmed the dates: a year-less one is this year's (and flagged)
        for key in ('when', 'first_contact'):
            if mail._when(item.get(key) or ''):
                item[key] = _this_year(item[key], now)
    step(f"Claude found: {kind}{' · ' + (item.get('role') or item.get('title')) if (item.get('role') or item.get('title')) else ''}"
         " — updating the job in Notion")
    talking = talking or bool(item.get('owner_agreed'))
    seed = hashlib.sha256(re.sub(r'\s+', ' ', text).lower().encode() + b''.join(s[1] for s in images_of(image))).hexdigest()[:16]
    source_id = f'paste:{seed}'
    when = item['when'] if mail._when(item.get('when') or '') else now.isoformat(timespec='seconds')
    first_here = item.get('first_contact_here')
    # A new job's first contact: its first event is dated when the conversation began, so a later contact logged
    # from another channel can't take its Source (the earliest-contact rule reads the events' dates).
    began = item['first_contact'] if first_here and mail._when(item.get('first_contact') or '') else None
    summary = item.get('summary') or kind
    row = _row_for(tracker, job['url']) if job and job.get('stage') else None

    if row is None and kind == OUTREACH:  # a recruiter's pitch: an open job it names, or a new lead
        lead = dict(item, job_url=job['url'], company=job.get('company') or item.get('company'),
                    title=job.get('title') or item.get('title')) if job else item
        row, line = opportunity.track(tracker, lead, text, source=source, event_source=event_source, talking=talking,
                                      at=began or when, seed=seed, extra_blocks=([_block('paragraph', f"⚠️ Check these details: {'; '.join(check)}.")] if check else [])
                                      + _image_blocks(tracker, image),
                                      note=f'Logged: {summary}'[:300])
        if not row:
            return 'ℹ️ ' + line
        fit = _rich(on_new, row, lead, text)
        return '🤝 ' + line + (f' · {fit}' if fit else '') + _check_line(check)

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

    stage, url = plain(row['properties'].get('Stage')), plain(row['properties'].get('Job URL'))
    filled = _fill_gaps(tracker, row, item) if not created else []
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
            return f'ℹ️ Already tracked: {label} ({stage}). Nothing new to log.'
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
    if not changed and filled:
        _keep(tracker, row, text, image, summary, when, _channel_named(item), check)
        return f"🧩 Updated: {label}: added {', '.join(filled)}.{_check_line(check)}"
    if not changed:
        return f'ℹ️ Already logged: {label} ({stage})'
    _keep(tracker, row, text, image, summary, when, _channel_named(item), check)
    fit = _rich(on_new, row, item, text) if created and not job else None  # an open job was scored by its search
    verb = 'Tracked' if created else 'Updated'
    return (f"{EMOJI.get(kind, '•')} {verb}: {label} → {changed}. {summary}" + (f' · {fit}' if fit else '')
            + (f" Added {', '.join(filled)}." if filled else '') + _check_line(check))


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
    parser.add_argument('--resync-source', metavar='PAGE_ID',
                        help="recompute a job's Source from its logged entries (the earliest contact wins)")
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required (Keychain entry job-pilotto.notion.token, or export it)')
    if args.resync_source:
        page_id = re.sub(r'[^0-9a-f]', '', args.resync_source.split('?')[0].lower())[-32:]
        changes = resync_source(tracker, page_id)
        shown = lambda value: (value.get('select') or {}).get('name') or ''.join(
            t['text']['content'] for t in value.get('rich_text') or [])
        print(', '.join(f'{name} → {shown(value)}' for name, value in changes.items()) or 'Source already right: nothing changed.')
        return 0
    text = open(args.text_file, encoding='utf-8').read() if args.text_file else ('' if args.image else sys.stdin.read())
    image = load_image(args.image) if args.image else None
    if args.image and not image:
        raise SystemExit(f'Not a screenshot: {args.image} (use .png, .jpg, .webp or .gif)')
    try:
        print(log(tracker, text=text, image=image, talking=args.talking))
        ledger.heal_touched(tracker)
    except ValueError as error:
        print(f'⚠️ {error}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
