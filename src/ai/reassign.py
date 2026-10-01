#!/usr/bin/env python3
"""Your answer about an email the Gmail check wasn't sure where to place.

- "Is this about …?" (Focus): an email event on no job (Needs you) goes to the job you pick, a new job, or nowhere.

    python -m src.ai.reassign move <event page id> <job URL | new | none>
Prints one JSON line: {"ok": true, "text": "..."}.
"""
import argparse
import json
import re
import sys

from ..notion import client as notion
from ..notion.ledger import plain
from . import mail, opportunity

NONE, NEW = 'none', 'new'


def _changes(event):
    try:
        return json.loads(plain(event['properties'].get('Changes')) or '{}')
    except ValueError:
        return {}


def _new_job(tracker, event, changes):
    """A job from the email alone (sender, subject): Focus then asks for its details."""
    sender, subject = changes.get('from', ''), changes.get('subject', '') or plain(event['properties'].get('Kind'))
    parsed = re.match(r'\s*"?([^"<]*)"?\s*<([^>]+)>', sender)
    name, address = parsed.groups() if parsed else ('', sender)
    linkedin = 'linkedin.com' in sender.lower()
    lead = {'title': subject[:120], 'company': '', 'recruiter_company': mail._sender_org(sender),
            'recruiter_name': '' if linkedin else mail.person_name(name), 'recruiter_email': '' if linkedin else address.strip(),
            'platform': 'LinkedIn' if linkedin else 'Email', 'in_house': False}
    source_id = plain(event['properties'].get('Source ID'))
    row, _ = opportunity.track(tracker, lead, f"Subject: {subject}\n\n{plain(event['properties'].get('Note'))}",
                               source='Gmail', event_source='Job Pilotto app', gmail_id=source_id,
                               at=(event['properties'].get('At') or {}).get('date', {}).get('start'),
                               note=f'From an email you placed: "{subject[:120]}"')
    return row or tracker.find(opportunity.lead_url(lead, '', source_id))


def move(tracker, event_id, target, now=None):
    """Put the email's event on the job you picked and let that job move on with it."""
    event = tracker._request('GET', f'pages/{event_id}')
    props, changes = event['properties'], _changes(event)
    kind = plain(props.get('Kind'))
    if target == NONE:
        tracker.update_page(event_id, {'Application': {'relation': []}, 'Needs you': {'checkbox': False}})
        return {'ok': True, 'text': 'Noted: not about a job.'}
    row = _new_job(tracker, event, changes) if target == NEW else tracker.find(target)
    if row is None:
        return {'ok': False, 'text': 'That job is no longer in your Notion. Pick it again, or choose a new job.'}
    fields = mail.advance(tracker, row, kind, changes.get('interview_at'), now)
    tracker.update_page(event_id, {'Application': {'relation': [{'id': row['id']}]}, 'Needs you': {'checkbox': False},
                                   'Changes': mail.changes_text(fields, changes.get('interview_at'),
                                                                {'from': changes.get('from', ''), 'subject': changes.get('subject', '')})})
    moved = ' → '.join(f"{name}: {after}" for name, (_, after) in fields.items() if name in ('Stage', 'Next interview'))
    return {'ok': True, 'text': f"Now on {mail._label(row)}" + (f" ({moved})" if moved else '') + '.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    moving = sub.add_parser('move')
    moving.add_argument('event_id')
    moving.add_argument('target', help='a job URL, "new" or "none"')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if tracker is None:
        print(json.dumps({'ok': False, 'text': 'Notion is not connected.'}))
        return 1
    try:
        result = move(tracker, args.event_id, args.target)
    except Exception as error:  # noqa: BLE001 — the app shows the reason
        result = {'ok': False, 'text': f'Notion: {type(error).__name__}: {error}'[:300]}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('ok') else 1


if __name__ == '__main__':
    sys.exit(main())
