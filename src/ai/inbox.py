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

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['kind', 'match', 'role', 'when', 'first_contact', 'interview_at', 'feedback'] + opportunity.SCHEMA['required'],
    'properties': {
        'kind': {'type': 'string', 'enum': KINDS},
        'match': {'type': 'integer', 'description': 'Index of the job in the list this is about, or -1 if none fits'},
        'role': {'type': 'string', 'description': 'Role title the item names, else ""'},
        'when': {'type': 'string', 'description': 'ISO 8601 date/time the message was sent if shown, else ""'},
        'first_contact': {'type': 'string', 'description': 'ISO 8601 date of the earliest message shown in the conversation (the first time they talked), else ""'},
        'interview_at': {'type': 'string', 'description': 'ISO 8601 start of a call/interview with a fixed time, with offset, else ""'},
        'feedback': {'type': 'string', 'description': 'Specific employer feedback quoted verbatim, else empty; no generic rejections or inferred reasons.'},
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
    blocks = []
    for shot in images_of(image):
        try:
            upload = tracker.upload_file(shot[0], shot[1], shot[2])
        except Exception as error:  # noqa: BLE001 — the update matters more than the picture
            print(f'Warning: screenshot not uploaded to Notion: {type(error).__name__}: {error}', file=sys.stderr)
            continue
        blocks.append({'object': 'block', 'type': 'image', 'image': {'type': 'file_upload', 'file_upload': {'id': upload}}})
    return blocks


def _keep(tracker, row, text, image, summary, when):
    """What was logged, on the job's page: a dated line, the message, the screenshot."""
    blocks = [_block('paragraph', f"{when[:10]} · {summary}", bold=True)]
    blocks += [_block('quote', part) for part in re.split(r'\n\s*\n', text.strip())[:40] if part.strip()] if text else []
    blocks += _image_blocks(tracker, image)
    try:
        tracker.append_blocks(row['id'], [_block('heading_3', LOG_HEADING)] + blocks)
    except Exception as error:  # noqa: BLE001
        print(f'Warning: not copied to the page: {type(error).__name__}: {error}', file=sys.stderr)


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
    row = tracker.create_page(tracker.database_id, props)
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


def _fill_gaps(tracker, row, item):
    """What a job was missing (the employer behind an agency's invitation, where, the pay) from the pasted message.
    Only empty fields are filled: nothing you or an earlier message wrote is replaced. And where you first talked:
    a conversation (e.g. a LinkedIn chat) that began before the job was tracked (e.g. from the later email invite)
    becomes its Reached via. Returns what was filled."""
    changes = {name: {'rich_text': [{'text': {'content': str(item[key])[:200]}}]}
               for name, key in GAPS.items() if item.get(key) and not plain(row['properties'].get(name))}
    # A job known only from an invitation ("SRE"): the fuller title the message gives ("Principal SRE"), when it
    # contains the one there (never a different role).
    title, current = (item.get('role') or item.get('title') or '').strip(), plain(row['properties'].get('Job'))
    words = lambda text: set(re.findall(r'[a-z0-9]+', text.lower()))
    if title and current and len(title) > len(current) and words(current) <= words(title):
        changes['Job'] = {'title': [{'text': {'content': title[:200]}}]}
    platform, began = item.get('platform'), mail._when(item.get('first_contact') or '')
    tracked = mail._when(row.get('created_time') or '')
    if (platform in opportunity.REACHED_VIA and platform != 'Other' and began and tracked and began < tracked
            and plain(row['properties'].get('Reached via')) != platform):
        changes['Reached via'] = {'select': {'name': platform}}
    if changes:
        tracker.update_page(row['id'], changes)
        for name, value in changes.items():
            row['properties'][name] = ({'type': 'select', 'select': value['select']} if 'select' in value else
                                       {'type': 'title', 'title': [{'plain_text': value['title'][0]['text']['content']}]} if 'title' in value else
                                       {'type': 'rich_text', 'rich_text': [{'plain_text': value['rich_text'][0]['text']['content']}]})
    named = {'Job': f'the title "{title}"', 'Reached via': f'first contact on {platform}'}
    return [GAPS.get(name) or named[name] for name in changes]


def log(tracker, *, text='', image=None, client=None, model=DEFAULT_MODEL, talking=False, source='Manual',
        event_source='CLI', stats=None, now=None, target='', on_new=None):
    """Read one pasted message or screenshot, update or create the job it's about. Returns one line for the reply.
    target: '' = Claude decides which job; 'new' = a new job; a job URL = that job (the app's "Which job?").
    on_new(url, job, row): called for a job tracked here for the first time (src/ai/added.hook: facts, fit score,
    Job Matches row, like a found job); returns a short line for the reply, or None."""
    text = (text or '').strip()
    if not image and len(text) < opportunity.MIN_TEXT:
        raise ValueError('Paste the whole message or a screenshot of it, not just a line.')
    if client is None:
        if not os.getenv('ANTHROPIC_API_KEY'):
            raise ValueError('Reading a message needs your Anthropic API key (Settings → AI).')
        import anthropic
        client = anthropic.Anthropic()
    now = now or datetime.now(timezone.utc)
    jobs = candidates(tracker)
    item = read(client, model, text, image, jobs, stats)
    kind = item['kind']
    if kind == NOT_JOB and target:  # you said which job it's about: log it as a reply there
        kind = REPLY
    if kind == NOT_JOB and not target:
        raise ValueError("That doesn't look like a message about a job, so nothing was logged.")
    talking = talking or bool(item.get('owner_agreed'))
    seed = hashlib.sha256(re.sub(r'\s+', ' ', text).lower().encode() + b''.join(s[1] for s in images_of(image))).hexdigest()[:16]
    source_id = f'paste:{seed}'
    when = item.get('when') if mail._when(item.get('when') or '') else now.isoformat(timespec='seconds')
    summary = item.get('summary') or kind
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
    row = _row_for(tracker, job['url']) if job and job.get('stage') else None

    if row is None and kind == OUTREACH:  # a recruiter's pitch: an open job it names, or a new lead
        lead = dict(item, job_url=job['url'], company=job.get('company') or item.get('company'),
                    title=job.get('title') or item.get('title')) if job else item
        row, line = opportunity.track(tracker, lead, text, source=source, event_source=event_source, talking=talking,
                                      at=when, seed=seed, extra_blocks=_image_blocks(tracker, image),
                                      note=f'Logged: {summary}'[:300])
        if not row:
            return 'ℹ️ ' + line
        fit = _rich(on_new, row, lead, text)
        return '🤝 ' + line + (f' · {fit}' if fit else '')

    created = False
    if row is None and job:  # an open job, not tracked yet
        day = _day(when) if kind == APPLIED else None
        ledger.add_application(tracker, job['url'], applied=day or now.date(), approx=kind != APPLIED, source=source,
                               meta={'title': job.get('title'), 'company': job.get('company'), 'location': job.get('location')})
        row, created = _row_for(tracker, job['url']), True
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
        _keep(tracker, row, text, image, summary, when)
        return f"🧩 Updated: {label}: added {', '.join(filled)}."
    if not changed:
        return f'ℹ️ Already logged: {label} ({stage})'
    _keep(tracker, row, text, image, summary, when)
    fit = _rich(on_new, row, item, text) if created and not job else None  # an open job was scored by its search
    verb = 'Tracked' if created else 'Updated'
    return f"{EMOJI.get(kind, '•')} {verb}: {label} → {changed}. {summary}" + (f' · {fit}' if fit else '')


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
