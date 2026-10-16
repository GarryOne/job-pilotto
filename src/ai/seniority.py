"""Seniority from the job title: a free shortcut in front of the AI's read (CLAUDE.md: a word list is at most a shortcut, never the judge).

The title states a level in a few words ("Senior", "Staff", "Principal", "Lead", "Junior"), in several languages. The AI reads the whole posting and answers the
seniority fact; this module only settles the cases a title decides by itself: an AI answer of "unknown" takes the title's level, and an explicit Staff/Principal/Lead
word lifts a lower read (Free AI answered "unknown" or "senior" for "Principal ..." and "Lead ..." titles, 16 Oct 2026). It never lowers a level and never replaces
a level the title does not state. Guard: tests/test_seniority.py (titles with the same word and a different meaning: "Staff Nurse", "Lead Generation").
"""
import re

RANK = {'unknown': 0, 'junior': 1, 'mid': 2, 'senior': 3, 'staff_principal': 4, 'lead_manager': 5}
_TECH = r'(?:engineer|engineers|developer|software|sre|devops|architect|scientist|designer|programmer|ingenieur|ingénieur|ingeniero|entwickler|sviluppatore|data|platform|site reliability)'
# (level, pattern), strongest first; the first match decides.
_RULES = [
    ('lead_manager', re.compile(r'\b(?:head of|team ?lead|tech(?:nical)? lead|engineering manager|director|teamleiter(?:in)?|abteilungsleiter(?:in)?|leiter(?:in)?|responsable d)\b|^\s*lead\b(?!\s*(?:gen|generation|nurse|auditor|painter|developer relations))', re.I)),
    ('staff_principal', re.compile(rf'\bprincipal\b|\bstaff\b(?=\s+(?:\w+\s+)?{_TECH})', re.I)),
    ('senior', re.compile(r'\b(?:senior|sr\.?|sénior|leitende?r?)(?=\W|$)', re.I)),
    ('junior', re.compile(r'\b(?:junior|jr\.?|entry[- ]level|trainee|praktikant(?:in)?|stagiaire|werkstudent(?:in)?)(?=\W|$)', re.I)),
    ('mid', re.compile(r'\bmid[- ]?level\b|\(mid\)', re.I)),
]


def from_title(title):
    """-> (level, the words of the title that state it) or None."""
    for level, pattern in _RULES:
        found = pattern.search(title or '')
        if found:
            return level, found.group(0).strip()
    return None


def settle(title, seniority):
    """The AI's {value, evidence} seniority fact and the title -> the fact with the title's level applied where the title decides."""
    stated = from_title(title)
    if not stated:
        return seniority
    level, words = stated
    have = (seniority or {}).get('value', 'unknown')
    if have == 'unknown' or (level in ('staff_principal', 'lead_manager') and RANK[level] > RANK.get(have, 0)):
        return {'value': level, 'evidence': words}
    return seniority
