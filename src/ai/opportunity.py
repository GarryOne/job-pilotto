#!/usr/bin/env python3
"""Recruiter leads: a role someone pitched to you (an email, a LinkedIn message), tracked like an application.

A recruiter's message has no job posting to crawl, so Claude Haiku 4.5 reads the message itself: role, employer
(or the hidden client, e.g. "logistics software, Series A"), salary, work mode, contract, the recruiter and their
agency. That becomes an Applications row at Stage "Recruiter lead" (or "Screening" when you're already talking)
with Channel Agency/Direct, Via = the agency, Contact = the recruiter, and the original message in the page body,
plus a "Recruiter lead" event. From then on the Gmail check matches the recruiter's follow-ups (by name, email and
agency) like any other application.

Three ways in:
- Gmail: the scheduled mail check (src/ai/mail.py) classifies a recruiter's pitch as "Recruiter outreach".
- Telegram: /add followed by the message text (no job link), or forward the message to the bot.
- The Desktop App: Jobs → "Recruiter message…", or this command.

Usage:
  python -m src.ai.opportunity add --text-file message.txt [--talking] [--source-label LinkedIn]
  pbpaste | python -m src.ai.opportunity add [--talking]
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

from ..notion import client as notion
from ..notion.ledger import _block, _text, add_event
from . import cost

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_MAIL_MODEL', 'claude-haiku-4-5')
LEAD_STAGE = 'Recruiter lead'
HEADING = '🤝 Recruiter message'
MIN_TEXT = 40  # shorter than this isn't a recruiter's message (e.g. a date after /add)
WORK_MODES = ('On-site', 'Hybrid', 'Remote')

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['is_opportunity', 'title', 'company', 'client', 'location', 'work_mode', 'salary', 'contract',
                 'recruiter_name', 'recruiter_email', 'recruiter_company', 'in_house', 'platform', 'job_url', 'summary',
                 'owner_agreed'],
    'properties': {
        'is_opportunity': {'type': 'boolean', 'description': 'A person pitches the owner a specific role (not a job alert or newsletter)'},
        'title': {'type': 'string', 'description': 'Role title, e.g. "Senior DevOps Engineer"'},
        'company': {'type': 'string', 'description': 'Hiring company when named, else ""'},
        'client': {'type': 'string', 'description': 'When the employer is hidden: a short description ("logistics software, Series A"), else ""'},
        'location': {'type': 'string', 'description': 'Where, e.g. "Remote (Europe)", "Prague"; "" if not stated'},
        'work_mode': {'type': 'string', 'enum': ['On-site', 'Hybrid', 'Remote', '']},
        'salary': {'type': 'string', 'description': 'As stated, e.g. "€70k–90k (maybe €100k) + equity"; "" if not stated'},
        'contract': {'type': 'string', 'description': 'e.g. "B2B contract", "permanent"; "" if not stated'},
        'recruiter_name': {'type': 'string'},
        'recruiter_email': {'type': 'string', 'description': "The recruiter's email if written, else \"\""},
        'recruiter_company': {'type': 'string', 'description': 'Agency or platform the recruiter works for, else ""'},
        'in_house': {'type': 'boolean', 'description': "True when the recruiter works for the hiring company itself"},
        'platform': {'type': 'string', 'enum': ['Email', 'LinkedIn', 'Other']},
        'job_url': {'type': 'string', 'description': 'Link to the job posting itself if the message has one (not a booking or profile link), else ""'},
        'summary': {'type': 'string', 'description': 'Up to 3 short facts worth knowing (team, stack, travel), max 200 characters'},
        'owner_agreed': {'type': 'boolean', 'description': 'The text includes the owner replying that they are interested or agreeing to talk'},
    },
}

SYSTEM = """You read a message a recruiter or hiring person sent the owner of Job Pilotto (an email, or a LinkedIn \
message pasted as text) and extract the role they pitch. Only state what the message says; never guess. The owner's \
own replies may be included: ignore them for the facts, but set owner_agreed when the owner said yes or \
agreed to a call. If the message isn't a pitch for a role (a job alert, \
a newsletter, a rejection), set is_opportunity false and leave the rest empty."""


def extract(client, model, text, sender='', stats=None):
    """Claude's reading of a recruiter's message: a dict with SCHEMA's fields."""
    content = (f'From: {sender}\n\n' if sender else '') + text[:8000]
    response = client.messages.create(
        model=model, max_tokens=1000, system=SYSTEM, messages=[{'role': 'user', 'content': content}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}},
    )
    cost.add(stats, model, response.usage)
    return json.loads(next(b.text for b in response.content if b.type == 'text'))


def lead_url(lead, text, gmail_id=''):
    """The row's Job URL (the Applications key): the posting if the message links one, else the Gmail message,
    else a stable link derived from the message text (the same message pasted twice stays one row)."""
    if lead.get('job_url', '').startswith(('http://', 'https://')):
        return lead['job_url']
    if gmail_id:
        return f'https://mail.google.com/mail/u/0/#all/{gmail_id}'
    digest = hashlib.sha256(re.sub(r'\s+', ' ', text).strip().lower().encode()).hexdigest()[:16]
    if lead.get('platform') == 'LinkedIn':
        return f'https://www.linkedin.com/messaging/#jp-{digest}'
    return f'https://www.jobpilotto.workers.dev/lead#{digest}'


def contact(lead):
    return ' · '.join(p for p in (lead.get('recruiter_name'), lead.get('recruiter_email')) if p)


def title(lead):
    return (lead.get('title') or 'Role').strip()[:200]


def label(lead):
    """"Senior DevOps Engineer — logistics software (client) via Example Talent"."""
    who = lead.get('company') or (f"{lead['client']} (client)" if lead.get('client') else '')
    via = lead.get('recruiter_company') if not lead.get('in_house') else ''
    return ' — '.join(p for p in (title(lead), who) if p) + (f' via {via}' if via and via != who else '')


def properties(lead, url, stage, source):
    via = '' if lead.get('in_house') else lead.get('recruiter_company', '')
    notes = [f"Recruiter message ({lead.get('platform') or 'Other'})"]
    if lead.get('client'):
        notes.append(f"Client: {lead['client']}")
    if lead.get('contract'):
        notes.append(lead['contract'])
    if lead.get('summary'):
        notes.append(lead['summary'])
    props = {
        'Job': {'title': [{'text': {'content': title(lead)}}]},
        'Job URL': {'url': url},
        'Stage': {'select': {'name': stage}},
        # Hidden employer: Company stays empty (the Gmail check matches on names, and "hidden" matches too much).
        'Company': _text(lead.get('company')), 'Location': _text(lead.get('location')), 'Salary': _text(lead.get('salary')),
        'Channel': {'select': {'name': 'Direct' if lead.get('in_house') else 'Agency'}},
        'Via': _text(via), 'Contact': _text(contact(lead)), 'Recruiter': {'checkbox': not lead.get('in_house')},
        'Notes': _text('. '.join(notes)), 'Source': {'select': {'name': source}},
    }
    if lead.get('work_mode') in WORK_MODES:
        props['Work mode'] = {'select': {'name': lead['work_mode']}}
    return props


def track(tracker, lead, text, *, source, event_source, talking=False, at=None, gmail_id='', note=''):
    """The Applications row, the page body (the message) and the events. Returns (row, one-line summary);
    row is None when the message is already tracked."""
    url = lead_url(lead, text, gmail_id)
    if tracker.find(url):
        return None, f'Already tracked: {label(lead)}'
    talking = talking or bool(lead.get('owner_agreed'))
    stage = 'Screening' if talking else LEAD_STAGE
    row = tracker.create_page(tracker.database_id, properties(lead, url, stage, source))
    known = row.setdefault('properties', {})  # Notion returns the new row's properties; test fakes may not
    for name, value in (('Company', {'rich_text': [{'plain_text': lead.get('company') or ''}]}),
                        ('Job', {'title': [{'plain_text': title(lead)}]}), ('Job URL', {'url': url})):
        known.setdefault(name, value)
    blocks = [_block('paragraph', part) for part in re.split(r'\n\s*\n', text.strip())[:90] if part.strip()]
    try:
        tracker.replace_after_heading(row['id'], HEADING, blocks)
    except Exception as error:  # noqa: BLE001 — the row is what matters; the body is a convenience
        print(f'Warning: message not copied to the page: {type(error).__name__}: {error}', file=sys.stderr)
    at = at or datetime.now(timezone.utc).isoformat(timespec='seconds')
    event = add_event(tracker, row, LEAD_STAGE, event_source, at=at, note=note or f'Recruiter message: {label(lead)}'[:300])
    if gmail_id and event:
        tracker.update_page(event['id'], {'Source ID': {'rich_text': [{'text': {'content': gmail_id}}]}})
    if talking:
        add_event(tracker, row, 'Screening', event_source, note='Already talking to the recruiter when tracked')
    facts = ' · '.join(p for p in (lead.get('salary'), lead.get('location') or lead.get('work_mode')) if p)
    return row, f"Tracked recruiter lead: {label(lead)}{f' · {facts}' if facts else ''} ({stage})"


def add_from_text(tracker, text, *, client=None, model=DEFAULT_MODEL, source='Manual', event_source='CLI',
                  talking=False, stats=None):
    """A pasted or forwarded message -> a tracked lead. Returns one line for the reply."""
    text = (text or '').strip()
    if len(text) < MIN_TEXT:
        raise ValueError('Paste the whole recruiter message (the role, company, salary…), not just a line.')
    if client is None:
        if not os.getenv('ANTHROPIC_API_KEY'):
            raise ValueError('Reading a recruiter message needs your Anthropic API key (Settings → AI).')
        import anthropic
        client = anthropic.Anthropic()
    lead = extract(client, model, text, stats=stats)
    if not lead.get('is_opportunity'):
        raise ValueError("That doesn't read like a recruiter pitching a role, so nothing was added.")
    return track(tracker, lead, text, source=source, event_source=event_source, talking=talking)[1]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    add = sub.add_parser('add', help="track a recruiter's message (from a file, or stdin)")
    add.add_argument('--text-file', help='the message; default: stdin')
    add.add_argument('--talking', action='store_true', help="you've already replied yes: Stage Screening")
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required (Keychain entry job-pilotto.notion.token, or export it)')
    text = open(args.text_file, encoding='utf-8').read() if args.text_file else sys.stdin.read()
    try:
        print('🤝 ' + add_from_text(tracker, text, talking=args.talking))
    except ValueError as error:
        print(f'⚠️ {error}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
