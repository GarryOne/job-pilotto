"""Source scout, a page the user pasted: the companies named on any page they have (an AI talent agent's matches, a newsletter, a VC portfolio)
become candidates the scout probes first. The text, or one public address read once, goes to the same extraction call that reads company lists
(src/ai/scout_ideas.py: fixed answer shape, names validated, page text untrusted); the probe then finds each one's job board as for any name.
A personal or login page is never fetched by us: the user pastes its text. Started from the Employers page or ⌘K (desktop/lib/employers-handlers.js).
Tests: tests/test_scout_paste.py.
"""
import re
from datetime import date
from pathlib import Path

from .scout_candidates import harvest
from .scout_core import ensure_tables, key_for

PRIORITY = 96            # before the AI's ideas (92) and the role search (91): the user asked for these names now
MAX_TEXT = 30000
ENDED = {'found': 'already read', 'low': 'read before, few fitting roles', 'watch': 'no open jobs when last checked',
         'none': 'no public job list found before', 'pending': 'already waiting to be checked', 'manual': 'added by you before'}


def read_file(path, limit=MAX_TEXT):
    """The text the app wrote for this run, capped."""
    return Path(path).read_text(encoding='utf-8', errors='replace')[:limit]


def page_text_of(text, get=None):
    """(text for the extraction call, the address it was read from or ''); one bare https address is read once, as a public page."""
    from .ai import scout_ideas
    from .sources import careers
    stripped = text.strip()
    if re.fullmatch(r'https://\S+', stripped):
        markup = (get or careers.get_text)(stripped)
        return scout_ideas.page_text(markup, stripped), stripped
    return stripped[:MAX_TEXT], ''


def add(db, text, client=None, get=None, search=None):
    """Extract the companies from `text` and queue the new ones. Returns {'new': [names], 'known': [(name, status)], 'error': ''}."""
    from .ai import scout_ideas
    report = {'new': [], 'known': [], 'error': ''}
    if not (text or '').strip():
        return report
    try:
        body, address = page_text_of(text, get)
    except Exception as error:  # noqa: BLE001 — a page that refuses or is gone: said in the summary
        report['error'] = f'the page could not be read ({type(error).__name__})'
        return report
    if not body.strip():
        return report
    if client is None:
        from .ai import engine
        client = engine.client(action='scout')
    intro = f'Page: {address}\n\n' if address else 'Text the user pasted from a page:\n\n'
    answer, _ = scout_ideas._ask(client, scout_ideas.READ_MODEL, scout_ideas.read_system(search), intro + body, scout_ideas.READ_SCHEMA)
    ensure_tables(db)   # a fresh install pastes before its first scout run has made them (18 Oct 2026: "no such table", the names lost)
    status = {row['key']: (row['name'], row['status']) for row in db.execute('SELECT key, name, status FROM scout_candidates')}
    found = scout_ideas.clean_candidates(answer.get('companies'), f'Pasted page {date.today().isoformat()}', PRIORITY, set(), scout_ideas.MAX_FROM_PAGE)
    fresh = []
    for candidate in found:
        known = status.get(key_for(candidate['name']))
        if known:
            report['known'].append((candidate['name'], known[1]))
        else:
            fresh.append(candidate)
    harvest(db, {}, [lambda: fresh])
    report['new'] = [c['name'] for c in fresh]
    return report


def summary(report):
    """One line for the run's log and the app."""
    if report['error']:
        return f'Pasted page: {report["error"]}. Paste its text instead.'
    if not report['new'] and not report['known']:
        return 'Pasted page: no company names found in it.'
    parts = []
    if report['new']:
        parts.append(f"{len(report['new'])} new, checked first: " + ', '.join(report['new']))
    if report['known']:
        parts.append(f"{len(report['known'])} known: " + ', '.join(f'{name} ({ENDED.get(state, state)})' for name, state in report['known']))
    return 'Pasted page: ' + '; '.join(parts) + '.'
