#!/usr/bin/env python3
"""Outbound or inbound: did you go after this opportunity, or did it find you? Derived from the Applications row
(no column of its own), the same way here and in the desktop app (desktop/renderer/origin.js); both are checked
against one table, tests/fixtures/opportunity_origin.json, so they cannot drift.

- Inbound: a recruiter's pitch (Stage "Recruiter lead", a "Recruiter lead" event, Notes "Recruiter message (…)":
  src/ai/opportunity.py, however it was logged: Gmail, Telegram, the app), or a job whose first contact was a
  LinkedIn message or a phone call (Source LinkedIn / Phone: src/ai/opportunity.py source_for).
- Outbound: everything else: found by a search, saved, applied from the app, "Applied elsewhere" (Notes
  "Logged from a paste (…)", even from a LinkedIn paste), a confirmation email (Source Gmail). Unknown or empty
  Source counts as outbound.
"""
INBOUND, OUTBOUND = 'inbound', 'outbound'
LEAD = 'Recruiter lead'
INBOUND_SOURCES = ('LinkedIn', 'Phone')
LEAD_NOTES = 'Recruiter message ('
ELSEWHERE_NOTES = 'Logged from a paste ('


def origin(source='', stage='', notes='', kinds=()):
    """'inbound' or 'outbound' for one Applications row (kinds: the event kinds logged on it, when known)."""
    notes = (notes or '').lstrip()
    if stage == LEAD or LEAD in (kinds or ()) or notes.startswith(LEAD_NOTES):
        return INBOUND
    if notes.startswith(ELSEWHERE_NOTES):
        return OUTBOUND
    return INBOUND if (source or '').strip() in INBOUND_SOURCES else OUTBOUND


def is_inbound(**fields):
    return origin(**fields) == INBOUND
