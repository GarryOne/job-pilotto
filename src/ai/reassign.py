#!/usr/bin/env python3
"""Your answer about an email the Gmail check wasn't sure where to place.

- "Is this about …?" (Focus): an email event on no job (Needs you) goes to the job you pick, a new job, or nowhere.

    python -m src.ai.reassign move <event id> <job URL | new | none>
Prints one JSON line: {"ok": true, "text": "..."}.
"""
import argparse
import json
import re
import sys

from ..stores import open_stores
from . import mail, opportunity

NONE, NEW = 'none', 'new'


def _new_job(stores, event, changes):
    """A job from the email alone (sender, subject): Focus then asks for its details. Its store record, or None."""
    sender, subject = changes.get('from', ''), changes.get('subject', '') or event['kind']
    parsed = re.match(r'\s*"?([^"<]*)"?\s*<([^>]+)>', sender)
    name, address = parsed.groups() if parsed else ('', sender)
    linkedin = 'linkedin.com' in sender.lower()
    lead = {'title': subject[:120], 'company': '', 'recruiter_company': mail._sender_org(sender),
            'recruiter_name': '' if linkedin else mail.person_name(name), 'recruiter_email': '' if linkedin else address.strip(),
            'platform': 'LinkedIn' if linkedin else 'Email', 'in_house': False}
    source_id = event['source_id']
    # BRIDGE(mail opportunity): remove when opportunity.track takes the stores (mac-20): track(stores, …) -> (record | None, summary)
    tracker = getattr(stores.applications, 'tracker', None)
    if tracker is None:
        return None
    row, _ = opportunity.track(tracker, lead, f"Subject: {subject}\n\n{event['note']}", source='Gmail',
                               event_source='Job Pilotto app', gmail_id=source_id, at=event['at'] or None,
                               note=f'From an email you placed: "{subject[:120]}"')
    url = ((row or {}).get('properties', {}).get('Job URL') or {}).get('url') or opportunity.lead_url(lead, '', source_id)
    return stores.applications.get(url)


def move(stores, event_id, target, now=None):
    """Put the email's event on the job you picked and let that job move on with it."""
    event = stores.events.get(event_id)
    if event is None:
        return {'ok': False, 'text': 'That email is no longer waiting for an answer.'}
    changes = event.get('changes') or {}
    if target == NONE:
        stores.events.update(event_id, {'app_id': '', 'needs_you': False})
        return {'ok': True, 'text': 'Noted: not about a job.'}
    record = _new_job(stores, event, changes) if target == NEW else stores.applications.get(target)
    if record is None:
        return {'ok': False, 'text': 'That job is no longer in your list. Pick it again, or choose a new job.'}
    interview_at = event.get('interview_at') or changes.get('interview_at')
    fields = mail.advance(stores, record, event['kind'], interview_at, now)
    stores.events.update(event_id, {'app_id': record['id'], 'needs_you': False, 'changes': mail.changes_of(
        fields, {'from': changes.get('from', ''), 'subject': changes.get('subject', '')})})
    moved = ' → '.join(f"{name}: {after}" for name, (_, after) in fields.items() if name in ('Stage', 'Next interview'))
    return {'ok': True, 'text': f"Now on {mail._label(record)}" + (f" ({moved})" if moved else '') + '.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    moving = sub.add_parser('move')
    moving.add_argument('event_id')
    moving.add_argument('target', help='a job URL, "new" or "none"')
    args = parser.parse_args(argv)
    try:
        result = move(open_stores(), args.event_id, args.target)
    except Exception as error:  # noqa: BLE001 — the app shows the reason
        result = {'ok': False, 'text': f'{type(error).__name__}: {error}'[:300]}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('ok') else 1


if __name__ == '__main__':
    sys.exit(main())
