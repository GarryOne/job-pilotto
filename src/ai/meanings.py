"""What content means, decided by AI in any language, each with the rule that answers only without AI (CLAUDE.md "Meaning comes from AI,
never from keyword lists"; the shared mechanism is src/ai/decide.py). One function per decision; the callers keep no words of their own.
Tests: tests/test_decide.py."""
import hashlib
import re

from . import decide

# The rules that answer only without AI (and, for calendar events, a free first row whose yes is trusted).
SCREEN = re.compile(r'screen|recruiter|talent|phone|intro', re.I)
BOOKING = re.compile(r'\b(book|slot|schedul|calendly|cal\.com|availability|available|pick a time|time that works)', re.I)
INTERVIEWISH = re.compile(r'interview|screening|recruit|hiring|technical|intro(duction)? call|call with|onsite|panel', re.I)
ROUND_KINDS = ('recruiter_screen', 'technical', 'hiring_manager', 'other')


def round_kind(round_):
    """What kind of round this was, from its name in any language ("Entretien RH", "Fachgespräch"): AI, kept per name; the English rule
    only without AI."""
    text = (round_ or '').strip()
    if not text:
        return 'other'
    found = decide.one('interview-round', text.lower(), text, ROUND_KINDS,
                       'The name of one interview round. recruiter_screen: a first call with a recruiter, HR or talent team; technical: a skills, '
                       'coding, design or take-home round; hiring_manager: with the hiring manager, a director or a final/culture round; other.')
    if found:
        return found
    if re.search(r'\b(technical|tech|system design|coding|live coding|pair(ing)?|take[- ]home|architecture|design|whiteboard)\b', text, re.I):
        return 'technical'
    if re.search(r'\b(hiring manager|hm|manager|behaviou?ral|culture|values|final|director|vp|cto)\b', text, re.I):
        return 'hiring_manager'
    return 'recruiter_screen' if SCREEN.search(text) else 'other'


def asks_to_book(note, rule=BOOKING):
    """The reply asks you to pick or book a time, in any language: AI, kept per note; BOOKING only without AI."""
    found = decide.one('asks-to-book', hashlib.sha256((note or '').encode()).hexdigest()[:20], note or '', ('asks_to_book', 'other'),
                       'A short note about an employer\'s or recruiter\'s reply. asks_to_book: it asks the candidate to pick, book or confirm '
                       'a time for a call or interview (a scheduling link, slots, availability); other: anything else.') if (note or '').strip() else 'other'
    return found == 'asks_to_book' if found else bool(rule.search(note or ''))


def job_events(events, text_of):
    """The calendar events that are a job interview or a call about a job, in any language: the English rule's yes for free, AI for the rest."""
    key = lambda event: event.get('id') or event.get('summary', '')
    sure = [e for e in events if INTERVIEWISH.search(e.get('summary', ''))]
    rest = [e for e in events if e not in sure]
    judged = decide.decide('calendar-event', {key(e): f"{e.get('summary', '')}\n{text_of(e)[:400]}" for e in rest}, ('job_interview', 'other'),
                           'One calendar event. job_interview: a job interview, screening or call with an employer or recruiter about a job; '
                           'other: anything else.') or {}
    return sure + [e for e in rest if judged.get(key(e)) == 'job_interview']
