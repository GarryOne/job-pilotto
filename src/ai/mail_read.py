"""Reading side of the Gmail check: saved state, the open applications, the Gmail queries and the model classification of emails.
Guarded by tests/test_mail_classify.py and tests/test_mail_state.py."""
from datetime import datetime
import json
import re

from ..notion import titles
from ..notion.funnel import PREPARED_STAGES
from ..notion.ledger import EVENTS_DATABASE_ID, OUTCOME_STAGES
from . import cost, engine, opportunity
from .mail_config import BATCH, INVITES, INVITE_MAILS, LINKEDIN_SENDERS, RECRUITER_DOMAINS, SCHEMA, SENDER_DOMAINS, STATE_FILE, SYSTEM, TZ


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


def ledger_key(stores):
    """Which ledger the saved state belongs to: the 📈 Application Events database on Notion (as before the stores, so
    an existing state file stays valid), else the store's name. Another store starts the state over."""
    return EVENTS_DATABASE_ID if stores.name == 'notion' else f'store:{stores.name}'


def save_state(state, path=STATE_FILE):
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {'ledger': state.get('ledger', EVENTS_DATABASE_ID), 'seen': state['seen'][-3000:],
             'notified': state['notified'][-1000:]}
    path.write_text(json.dumps(state))


def applications(stores):
    """The owner's outstanding jobs that emails and events can belong to, oldest first (stable indexes). Every job
    still in play, not only the ones already applied to: the role a confirmation is about is often still at Kit
    ready or Applying (1 Oct 2026: Canonical's SRE confirmation got no event because that row, at Kit ready, wasn't
    in the list the reader matched against, and the role looked untracked).
    All records are read and the stages are filtered here, in Python: Notion rejects a filter on a Stage choice the
    workspace doesn't have with a 400 that fails the whole check (a workspace whose "Saved" choice was removed did
    exactly that on 1 Oct 2026, and the check read nothing at all)."""
    keep = set(OUTCOME_STAGES) | {opportunity.LEAD_STAGE} | set(PREPARED_STAGES) | {'Saved'}
    rows = [row for row in stores.applications.list() if (row['stage'] or '') in keep]
    return sorted(rows, key=lambda r: (r['applied_on'] or '', r['id']))


def _field(row, name):
    """A job record's field as text ('' when empty): rows are store records (src/stores/base.py APPLICATION_FIELDS)."""
    value = row.get(name)
    return '' if value is None else str(value)


def _role(row):
    """The row's role: its Job title without " · Acme" / " · via Huxley" (src/notion/titles.py), for matching by role
    words and for lines that name the employer or agency themselves."""
    return titles.role_of(row.get('title') or '', row.get('company') or '', row.get('via') or '')


def verified_feedback(value, original):
    """The mail reader may classify, but it cannot invent employer quotations."""
    normal = lambda text: re.sub(r'\s+', ' ', text or '').strip()
    value = (value or '').strip()
    return value if len(value) >= 10 and normal(value) in normal(original) else ''


def query(apps, days):
    """One Gmail search: known senders or a tracked company's name, in any tab (an employer's mail can land in Promotions). No subject
    words: every other new inbox email is sorted by Claude, in any language (mail_triage)."""
    names = {n for r in apps for n in (_field(r, 'company'), _field(r, 'via')) if n and len(n) > 2 and len(n) < 40}
    terms = [f'from:{d}' for d in SENDER_DOMAINS + LINKEDIN_SENDERS] + [f'"{n}"' for n in sorted(names)]
    return f'newer_than:{days}d -in:chats -in:spam -in:trash -in:sent {{{" ".join(terms)}}}'


def extra_query(days):
    """A second, short search (a single long one risks Gmail's query limit): recruitment agencies and emailed
    calendar invitations, which the first search misses when nothing about them is tracked yet."""
    terms = [f'from:{d}' for d in RECRUITER_DOMAINS] + [INVITES, *INVITE_MAILS]
    return f'newer_than:{days}d -in:chats -in:spam -in:trash -in:sent {{{" ".join(terms)}}}'


def listing(apps):
    return '\n'.join(f"{i}. {_field(r, 'company') or '(employer not named)'} — {_role(r)} (stage {_field(r, 'stage')}"
                     f"{', via ' + _field(r, 'via') if _field(r, 'via') else ''}"
                     f"{', recruiter ' + _field(r, 'contact') if _field(r, 'contact') else ''}, applied {_field(r, 'applied_on') or '?'})"
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
            output_config=engine.structured(SCHEMA, model, 'low'),
        )
        cost.add(stats, model, response.usage)
        for result in json.loads(next(b.text for b in response.content if b.type == 'text'))['results']:
            results[result['index']] = result
    return results


def _unread_invitation(email):
    """A calendar invitation (subject "Invitation …", or "Updated invitation …"): someone invited the owner to a call.
    Its time doesn't matter: the check only reads mail from the last days, and a call that has just started is still
    one the owner wants on a job (2 Oct 2026: Friday's 21:30 booking was read at 22:05)."""
    return bool(re.match(r'\s*(updated )?invitation', email.get('subject', ''), re.I))


def _when(value):
    try:
        moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (AttributeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=TZ)
