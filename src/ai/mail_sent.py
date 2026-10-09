"""Your own sent emails to a recruiter (Replied events) and the review of new rejections.
Guarded by tests/test_mail_sent.py and tests/test_rejection.py."""
from html import escape
import re
import sys

from ..stores import rules
from .mail_config import YOU_REPLIED
from .mail_lines import _label, _short
from .mail_match import ENDED
from .mail_read import _field


EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
SENT_MAX = 30  # your sent emails read per check, at most


def contacts(apps):
    """The recruiters you write to: each email address an open application's Contact names -> those rows."""
    found = {}
    for row in apps:
        if _field(row, 'stage') in ENDED:
            continue
        for address in EMAIL.findall(_field(row, 'contact').lower()):
            found.setdefault(address, {})[row['id']] = row
    return found


def sent_query(addresses, days):
    """Only your sent mail to those contacts, in the check's window (read-only; nothing else of your mail is read)."""
    terms = ' '.join(f'to:{a} cc:{a}' for a in sorted(addresses)[:40])
    return f'in:sent newer_than:{days}d {{{terms}}}'


def sent_pass(stores, google, apps, index, days, stats, dry_run=False):
    """Your own emails to a tracked job's recruiter -> a "Replied" event (Source Gmail, Source ID = the message id,
    so never twice; the note is only its subject). Focus then knows you wrote last, and recommends a follow-up when
    it stays unanswered (src/focus.py follow_up): pressing Done is no longer the only way. No AI, no cost. A
    recipient named on several of your jobs is skipped (never a guess which one). Never fails the check."""
    from ..features import disabled
    known = contacts(apps)
    if not known or disabled('focus'):
        return 0
    recorded = 0
    try:
        for message_id in google.search(sent_query(known, days), limit=SENT_MAX):
            if message_id in index[0]:
                continue
            email = google.message(message_id)
            if 'SENT' not in (email.get('labels') or []):  # only what you sent
                continue
            to = set(EMAIL.findall(f"{email.get('to', '')} {email.get('cc', '')}".lower()))
            rows = {page_id: row for address in to & set(known) for page_id, row in known[address].items()}
            if len(rows) != 1:
                continue
            row = next(iter(rows.values()))
            if dry_run:
                print(f"{email['date'][:16]} you wrote to {_label(row)}: {email['subject'][:60]!r}")
                continue
            subject = re.sub(r'\s+', ' ', email.get('subject') or '').strip()[:80]
            _, existing = rules.add_event(stores, row, YOU_REPLIED, 'Gmail', at=email['date'], source_id=email['id'],
                                          note=f'You replied by email ("{subject}")' if subject else 'You replied by email')
            index[0].add(email['id'])
            if not existing:
                recorded += 1
                _short(stats, YOU_REPLIED, row)
    except Exception as error:  # noqa: BLE001 — your sent mail is extra: the check itself goes on
        print(f'Warning: your sent emails not checked: {type(error).__name__}: {error}', file=sys.stderr)
    return recorded


def review_rejections(stores, client, rejected, stats, backfill=2):
    """Why each new rejection happened (rejection.review, Sonnet 5), then up to `backfill` older rejections
    without a review. Lines for Telegram; a failed review is logged and retried next time (it stays pending)."""
    from ..features import disabled
    from . import rejection
    if disabled('rejection_review'):
        return []
    lines, done = [], set()
    todo = [(row, f"Subject: {email['subject']}\n\n{email['body']}") for row, email in rejected]
    try:
        todo += [(row, '') for row in rejection.pending(stores, backfill) if row['id'] not in {r['id'] for r, _ in rejected}]
    except Exception as error:  # noqa: BLE001
        print(f'Warning: rejected applications not listed: {type(error).__name__}: {error}', file=sys.stderr)
    for row, email_text in todo:
        if row['id'] in done:
            continue
        done.add(row['id'])
        row = dict(row, stage='Rejected')
        try:   # the review reads the Profile from the store itself
            _, summary = rejection.review(stores, row, email_text=email_text, client=client, stats=stats)
        except Exception as error:  # noqa: BLE001 — the Gmail check's own updates are already saved
            print(f'Warning: rejection review failed for {_label(row)}: {type(error).__name__}: {error}', file=sys.stderr)
            continue
        lines.append(escape(summary))
        if stats is not None:
            stats.setdefault('updates', []).append(summary)  # whole: the app wraps it
    return lines
