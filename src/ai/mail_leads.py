"""Jobs an email introduces: the application a confirmation names, an interview lead, a recruiter lead.
Guarded by tests/test_mail_leads.py and tests/test_origin_column.py."""
from html import escape
import re
import sys

from .. import tgcard
from ..notion.ledger import REPLY, add_event
from . import opportunity
from .mail_lines import _head
from .mail_match import PLATFORMS, _matches, _same_person, _sender_org, person_name
from .mail_read import _field, _role


TRACKABLE = ('Confirmation received', REPLY, 'Interview scheduled', 'Rejected', 'Offer')


def _from_email(tracker, apps, result, email, stats, lines, on_new=None):
    """An Applications row for the role an email names (Stage Applied; the email's own event then moves it on).
    Keyed by company + role, so a second email about it (a duplicate, the rejection after the confirmation) finds it."""
    company, role = result['company'].strip(), result['role'].strip()
    words = lambda text: ' '.join(re.findall(r'[a-z0-9]+', text.lower()))
    same = [r for r in apps if words(_field(r, 'Company')) == words(company)
            and words(_role(r)) and (words(role) in words(_role(r)) or words(_role(r)) in words(role))]
    if same:
        return same[0]
    # A recruiter's lead with the employer hidden (Company empty, Via = the agency): an email that names the employer may be
    # the same opportunity (2 Oct 2026: "AG Talent — Senior DevOps Engineer" and a twin "Blinq — DevOps Engineer").
    # Merged only when sure: the same person (the lead's contact email or name is in the email) and the same role.
    # Anything weaker (only the agency matches, another role, several leads) is asked about, never guessed
    # and never a new row: the caller asks in Focus and on the check's card.
    text = f"{email.get('from', '')} {email.get('subject', '')} {email.get('body', '')}"
    leads = [r for r in apps if not _field(r, 'Company') and _matches(r, text)]
    sure = [r for r in leads if _same_person(r, text) and words(_role(r))
            and (words(role) in words(_role(r)) or words(_role(r)) in words(role))]
    if len(sure) == 1 and company:
        tracker.update_page(sure[0]['id'], {'Company': {'rich_text': [{'text': {'content': company[:200]}}]}})
        sure[0]['properties']['Company'] = {'type': 'rich_text', 'rich_text': [{'plain_text': company}]}
        return sure[0]
    if leads:
        return None
    applied = (email['date'] or '')[:10]
    # The role may be on the list before it was applied to (Saved, Kit ready…) and applied to without marking it:
    # that row becomes the application, so the job keeps its posting, kit and fit instead of getting a twin.
    try:
        earlier = [r for r in tracker.query_database(tracker.database_id, {'property': 'Company', 'rich_text': {'equals': company}})
                   if words(_role(r)) and (words(role) in words(_role(r)) or words(_role(r)) in words(role))]
    except Exception:  # noqa: BLE001 — then a new row, as before
        earlier = []
    if earlier:
        row = earlier[0]
        before = _field(row, 'Stage') or 'on your list'
        changes = {'Stage': {'select': {'name': 'Applied'}}, 'Date approximate': {'checkbox': True}}
        if applied and not _field(row, 'Applied on'):
            changes['Applied on'] = {'date': {'start': applied}}
        tracker.update_page(row['id'], changes)
        for name, value in changes.items():
            row['properties'][name] = {'type': next(iter(value)), **value}
        add_event(tracker, row, 'Applied', 'Gmail', at=applied or None,
                  note=f'Applied without marking it; found in the email "{email["subject"][:120]}" (date is an upper bound)')
        apps.append(row)
        lines.append(tgcard.block(_head(row, 'Applied'), f"Marked applied from this email (it was {escape(before)})."))
        if stats is not None:
            stats.setdefault('updates', []).append(f"➕ Marked applied · {company} — {role[:70]}")
        return row
    # No job found for it: asked, never created (owner, 7 Oct 2026: a photographer's Gmail check created two Anthropic SRE applications from the
    # inbox's own past, each a row with a Gmail link for its posting, no description, and fit 5). The caller asks "Which job?" in Focus; the
    # answer can be a job, a new job (src/ai/reassign.py, made then, with your OK) or none.
    return None


def interview_lead(tracker, client, model, email, apps, result, stats):
    """An interview invitation about a job nothing tracks yet: the Applications row from the email (role, agency,
    contact, the message), at Screening; the caller then records the interview (Stage Interview scheduled, Next
    interview). The employer is often unnamed: Focus then asks the owner to add the details. None if not tracked."""
    text = f"Subject: {email['subject']}\n\n{email['body']}"
    try:
        lead = opportunity.extract(client, model, text, sender=email['from'], stats=stats)
    except Exception as error:  # noqa: BLE001 — the email's own facts are enough to track it
        print(f"Warning: interview email {email['id']} not read: {type(error).__name__}: {error}", file=sys.stderr)
        lead = {}
    linkedin = 'linkedin.com' in email['from'].lower()
    lead = {**lead, 'title': lead.get('title') or result.get('role') or email['subject'][:120],
            'company': lead.get('company') or '', 'platform': 'LinkedIn' if linkedin else 'Email'}
    if (lead.get('recruiter_company') or '').lower() in PLATFORMS:
        lead['recruiter_company'] = ''
    if not lead.get('company') and not lead.get('recruiter_company'):
        lead['recruiter_company'] = _sender_org(email['from'])
    if not linkedin and not lead.get('recruiter_email'):  # the next email from this person finds this job
        parsed = re.match(r'\s*"?([^"<]*)"?\s*<([^>]+)>', email['from'])
        name, address = parsed.groups() if parsed else ('', email['from'])
        lead['recruiter_email'] = address.strip()
        lead['recruiter_name'] = lead.get('recruiter_name') or person_name(name)
    try:
        row, _ = opportunity.track(tracker, lead, text, source='Gmail', event_source='Gmail', talking=True,
                                   at=email['date'], gmail_id=email['id'],
                                   note=f"Interview invitation: \"{email['subject'][:120]}\"")
    except Exception as error:  # noqa: BLE001
        print(f"Warning: interview email {email['id']} not tracked: {type(error).__name__}: {error}", file=sys.stderr)
        return None
    if row is not None:
        apps.append(row)
        if stats is not None:
            stats.setdefault('updates', []).append(f"❓ Interview · {opportunity.label(lead)} — which job? Add details"[:140])
    return row


def new_lead(tracker, client, model, email, apps, stats, on_new=None):
    """A recruiter's pitch -> a tracked recruiter lead (opportunity.track); lines for Telegram."""
    text = f"Subject: {email['subject']}\n\n{email['body']}"
    try:
        lead = opportunity.extract(client, model, text, sender=email['from'], stats=stats)
    except Exception as error:  # noqa: BLE001 — one unreadable email must not stop the check
        print(f"Warning: recruiter email {email['id']} not read: {type(error).__name__}: {error}", file=sys.stderr)
        return []
    if not lead.get('is_opportunity'):
        return []
    row, _ = opportunity.track(tracker, lead, text, source='Gmail', event_source='Gmail', at=email['date'],
                               gmail_id=email['id'], note=f"Recruiter email: \"{email['subject'][:120]}\"")
    if not row:
        return []
    apps.append(row)  # a second email in this batch about the same role matches it
    fit = on_new(opportunity.lead_url(lead, text, email['id']), {
        'title': opportunity.title(lead), 'company': lead.get('company') or '', 'location': lead.get('location') or '',
        'work_mode': lead.get('work_mode') or '', 'description': text[:8000]}, row) if on_new else None
    if stats is not None:
        stats.setdefault('updates', []).append(f"🤝 Recruiter lead · {opportunity.label(lead)}"[:140])
    link = (f"<a href=\"{escape(row['url'], quote=True)}\">In Notion</a>" if row.get('url') else '')
    return [tgcard.block(f"New recruiter lead · {escape(opportunity.label(lead))}",
                         escape(tgcard.dot(lead.get('salary'), fit)), link,
                         tgcard.fact('Next step', 'set Stage to Screening once you reply'))]
