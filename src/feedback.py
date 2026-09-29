"""Employer feedback loop. Notion holds the status, verbatim feedback and timeline; no AI or email sending."""
import argparse
from datetime import datetime, timezone
import hashlib
import json

from .notion import client as notion
from .notion.ledger import EVENTS_DATABASE_ID, add_event, moment, plain

REACHED = {'Screening', 'Interview scheduled', 'Interviewing', 'Offer'}
REQUESTED, RECEIVED, REVIEWED, SKIPPED = ('Feedback requested', 'Feedback received', 'Feedback reviewed', 'Feedback skipped')
STATUSES = {REQUESTED: 'Asked for feedback', RECEIVED: 'Received feedback',
            REVIEWED: 'Received feedback', SKIPPED: 'Skipped'}


def _moment(value):
    return value.astimezone(timezone.utc) if isinstance(value, datetime) else moment(value)


def eligible(row, history=()):
    """A recorded Screening or later, before rejection. Replies/assessments alone are not proof."""
    from .features import disabled
    if disabled('feedback'):
        return False
    if plain(row['properties'].get('Feedback status')) == 'Not asked':
        return True  # the prior stage was captured when the rejection arrived
    rejected = [_moment(e.get('at')) for e in history if e.get('kind') == 'Rejected']
    cutoff = min(rejected) if rejected else datetime.max.replace(tzinfo=timezone.utc)
    return any(e.get('kind') in REACHED and e.get('at') and _moment(e.get('at')) <= cutoff for e in history)


def history_for(tracker, row):
    return [{'kind': plain(e['properties'].get('Kind')), 'at': plain(e['properties'].get('At'))}
            for e in tracker.query_database(EVENTS_DATABASE_ID, {'property': 'Application', 'relation': {'contains': row['id']}})]


def draft(row):
    job = plain(row['properties'].get('Job')) or 'the role'
    return (f'Hi,\n\nThank you for letting me know, and for considering me for {job}. '
            'I appreciate your time.\n\nI accept the decision and am not asking you to reconsider. '
            'I am trying to improve for future opportunities, so I would really appreciate '
            'one or two specific points on what most influenced the decision.\n\n'
            'If detailed feedback is not possible, even a short indication would help: '
            'technical fit (which area), communication or collaboration, relevant experience or '
            'role-specific knowledge, or compensation expectations above the budget. '
            'If it was something else, that is useful too.\n\n'
            'A single sentence is plenty; if possible, one example or one thing to work on '
            'would help me turn it into a practical improvement.\n\nThank you again.')


def receive(tracker, row, text):
    """Store employer words separately from AI guesses; preserve every reply, within Notion's limit."""
    text = (text or '').strip()
    from .features import disabled
    if disabled('feedback'):
        return
    if not text:
        raise ValueError('Paste the feedback you received first.')
    previous = plain(row['properties'].get('Employer feedback')) or ''
    combined = previous if text in previous else '\n\n'.join(filter(None, [previous, text]))
    if len(combined) > 100_000:
        raise ValueError('Feedback is too long; save a shorter excerpt.')
    tracker.update_page(row['id'], {
        'Employer feedback': {'rich_text': [{'text': {'content': combined[i:i + 1900]}} for i in range(0, len(combined), 1900)]},
        'Feedback status': {'select': {'name': STATUSES[RECEIVED]}},
        # A previous AI assessment must be reconsidered against the employer's actual words.
        'Rejection reason': {'select': None}, 'Rejection lesson': {'rich_text': []},
    })
    row['properties']['Employer feedback'] = {'type': 'rich_text', 'rich_text': [{'plain_text': combined}]}
    row['properties']['Feedback status'] = {'type': 'select', 'select': {'name': STATUSES[RECEIVED]}}


def act(tracker, row, action, text=''):
    from .features import disabled
    if disabled('feedback'):
        raise ValueError('Employer feedback is disabled in your settings.')
    history = history_for(tracker, row)
    if action in ('request', 'skip') and plain(row['properties'].get('Stage')) != 'Rejected':
        raise ValueError('This feedback follow-up is for a rejected application.')
    if action in ('request', 'skip') and not eligible(row, history):
        raise ValueError('Only rejections after Screening or a later stage need a feedback request.')
    kind = {'request': REQUESTED, 'receive': RECEIVED, 'review': REVIEWED, 'skip': SKIPPED}[action]
    existing = [e for e in history if e['kind'] == kind]
    if action in ('request', 'skip') and existing:
        return  # a repeated click must not create another request/review
    if action == 'review' and existing:
        latest_review = max(moment(e['at']) for e in existing)
        latest_received = max((moment(e['at']) for e in history if e['kind'] == RECEIVED), default=latest_review)
        if latest_review >= latest_received:
            return
    if action in ('request', 'skip') and plain(row['properties'].get('Feedback status')) in ('Received feedback', 'Asked for feedback'):
        raise ValueError('Feedback was already requested or received; refresh the job.')
    if action == 'receive':
        seed = 'feedback:' + hashlib.sha256(text.strip().encode()).hexdigest()[:24]
        events = tracker.query_database(EVENTS_DATABASE_ID, {'property': 'Source ID', 'rich_text': {'equals': seed}})
        if any(any(link['id'].replace('-', '') == row['id'].replace('-', '') for link in
                   e['properties'].get('Application', {}).get('relation', [])) for e in events):
            return
        receive(tracker, row, text)
        event = add_event(tracker, row, kind, 'Job Pilotto app', note=text[:1900])
        tracker.update_page(event['id'], {'Source ID': {'rich_text': [{'text': {'content': seed}}]}})
    else:
        if action == 'review' and not plain(row['properties'].get('Employer feedback')):
            raise ValueError('There is no employer feedback to review yet.')
        tracker.update_page(row['id'], {'Feedback status': {'select': {'name': STATUSES[kind]}}})
        add_event(tracker, row, kind, 'Job Pilotto app', note={
            'request': 'You sent a feedback request (confirmed in the desktop app).',
            'review': 'You reviewed the employer feedback.', 'skip': 'You chose not to request feedback.'}[action])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('page_id')
    parser.add_argument('action', choices=('request', 'receive', 'review', 'skip'))
    parser.add_argument('--text', default='')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('Notion is required to save feedback.')
    try:
        act(tracker, tracker._request('GET', f'pages/{args.page_id}'), args.action, args.text)
        print(json.dumps({'ok': True}))
    except ValueError as error:
        print(json.dumps({'ok': False, 'error': str(error)}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
