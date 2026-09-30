#!/usr/bin/env python3
"""An inbound job's title names who it is for: "Principal SRE · Acme", else "Principal SRE · via Huxley".

The Job Tracker's Job column of an opportunity that found you (Origin Inbound), so "Principal SRE" alone never hides
which job it is.

- Employer known: "Principal SRE · Acme". Only the agency known: "Principal SRE · via Huxley". Neither: the role.
- Outbound rows (job matches, kits, applied elsewhere) keep the bare role; their Company column carries the employer.
- Placeholders never count as a name (named(): empty, "unnamed", "unknown", parentheses, over 60 characters), the
  same rule as interview titles.
- Idempotent: a suffix already there is not added twice; a long role is shortened, never the employer or agency.
- role_of() is the inverse: the role alone, for every place that shows the employer or agency on its own line
  (the app's In conversation rows, the Inbound list, Focus labels) and for matching by role words.
- A title you edited is never replaced: only the bare role or a form this helper produced is updated (retitled()).

Set by src/notion/origin.py stamp() (every path that creates an Inbound row); updated when a logged message fills in
the employer or a fuller role (src/ai/inbox.py _fill_gaps).
"""
import re

SEP = ' · '
VIA = 'via '
MAX_TITLE = 100  # the whole title; the role is shortened to fit, never the employer or agency
PLACEHOLDER = re.compile(r'unnamed|unknown|not stated|not named|\bn/?a\b', re.I)


def named(value):
    """A company or agency name really given: short, no "unnamed"/"unknown" and no parentheses (a description such as
    "(unnamed finance client via recruiter)" is not a name). '' when it is not named."""
    value = re.sub(r'\s+', ' ', value or '').strip()
    if not value or len(value) > 60 or '(' in value or ')' in value or PLACEHOLDER.search(value):
        return ''
    return value


def _tails(company='', via=''):
    """The suffixes a title can carry for this employer / agency, most specific first."""
    tails = []
    if named(company):
        tails.append(named(company))
    if named(via):
        tails.append(VIA + named(via))
    return tails


def role_of(title, company='', via=''):
    """The role alone: the title without a generated " · Company" / " · via Agency" suffix (either one, so a title made
    before the employer was known still reads right). Any other title is returned as it is."""
    title = re.sub(r'\s+', ' ', title or '').strip()
    for tail in _tails(company, via):
        end = SEP + tail
        if len(title) > len(end) and title.lower().endswith(end.lower()):
            return title[:-len(end)].rstrip()
    return title


def _mentions(role, name):
    return bool(name) and re.search(rf'(?<![\w]){re.escape(name)}(?![\w])', role, re.I) is not None


def job_title(role, company='', via=''):
    """ "Role · Company" when the employer is named, else "Role · via Agency", else the role. Idempotent; a role that
    already names the employer or agency is kept as it is."""
    role = role_of(role, company, via)
    who, agency = named(company), named(via)
    if not role:
        return role
    tail = who or (VIA + agency if agency else '')
    if not tail or _mentions(role, who or agency):
        return role
    room = MAX_TITLE - len(SEP) - len(tail)
    if len(role) > room:
        role = role[:room - 1].rstrip(' ,·-–—/|(') + '…'
    return f'{role}{SEP}{tail}'


def generated(title, company='', via=''):
    """True when the title is the bare role or a form job_title() produces for this employer / agency (so it may be
    updated); False for a title you edited: one with a " · " part this helper did not write ("Principal SRE · Zurich
    team"), or one that already names the employer or agency its own way ("SRE at Huxley": kept by job_title())."""
    title = re.sub(r'\s+', ' ', title or '').strip()
    role = role_of(title, company, via)
    if SEP.strip() in role:
        return False
    forms = {role, job_title(role, company, via), job_title(role, '', via), job_title(role, company, '')}
    return title in forms


def retitled(title, company='', via='', *, was=None, role=None):
    """The new title for an Inbound row whose employer or agency is now (company, via), or '' when it stays.
    was: the (company, via) the title was made with, when they just changed. role: a fuller role just learned.
    A title you edited is never replaced."""
    was_company, was_via = was or (company, via)
    title = re.sub(r'\s+', ' ', title or '').strip()
    if not title:
        return ''
    base = role_of(role_of(title, was_company, was_via), company, via)
    if not (generated(title, was_company, was_via) or generated(title, company, via)):
        return ''
    new = job_title(role or base, company, via)
    return new if new and new != title else ''


def text_value(prop):
    prop = prop or {}
    if 'select' in prop:
        return (prop.get('select') or {}).get('name') or ''
    return ''.join(t.get('plain_text') or (t.get('text') or {}).get('content', '')
                   for t in prop.get('rich_text') or prop.get('title') or [])


def row_role(row):
    """The role of an Applications row (a Notion page, or its properties): its Job title without the suffix."""
    props = (row or {}).get('properties', row) or {}
    return role_of(text_value(props.get('Job')), text_value(props.get('Company')), text_value(props.get('Via')))


def title_property(value):
    return {'title': [{'text': {'content': (value or '')[:200]}}]}
