"""Matching an email or calendar event to a tracked application: company, agency, contact names, ambiguity.
Guarded by tests/test_mail_match.py."""
import re

from .mail_read import _field, _role


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
    title = words(_role(row)) - STOP
    text = words(f"{email.get('subject', '')} {email.get('body', '')[:6000]}")
    return bool(title) and len(title & text) < max(1, (len(title) + 1) // 2)


def _sender_org(sender):
    """"Huxley" from "Jaya <j.nejati@huxley.com>": the agency or company an email comes from."""
    domain = (re.search(r'@([\w.-]+)', sender or '') or [None, ''])[1].lower()
    parts = [p for p in domain.split('.') if p not in ('mail', 'email', 'co', 'com', 'ch', 'de', 'io', 'uk', 'net', 'org')]
    org = parts[-1] if parts else ''
    return '' if org in PLATFORMS else org.capitalize()


# Where a message comes from, not who sends it: never an agency or employer.
PLATFORMS = {'linkedin', 'gmail', 'googlemail', 'google', 'outlook', 'hotmail', 'live', 'yahoo', 'icloud', 'me', 'proton',
             'protonmail', 'gmx', 'calendly', 'cal', 'zoom', 'teams', 'microsoft', 'xing', 'indeed', 'glassdoor'}


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


def _same_person(row, text):
    """True if the text carries a contact's email address of this application, or names one of its contacts."""
    emails = re.findall(r'[\w.+-]+@[\w-]+\.[\w.-]+', _field(row, 'Contact').lower())
    return any(e in text.lower() for e in emails) or _names_person(row, text)


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
