"""Interview analysis, the call's facts about the job (salary, contract, place…): read from the review, merged with what the
job already says. Re-exported by src/ai/interviews.py. Tests: tests/test_interviews_advance_facts.py.
"""
import re

from ..notion.ledger import plain
from .interviews_ai import FACTS, NOT_STATED, SELECT_OPTIONS


def _norm(value):
    return re.sub(r'[\W_]+', ' ', str(value or '')).strip().casefold()


def _call_facts(text):
    """The "Call facts" column as {label: value} ("Label: value" parts, separated by · or new lines)."""
    facts = {}
    for part in re.split(r'\s+·\s+|\n', text or ''):
        label, sep, value = part.partition(':')
        if sep and label.strip():
            facts[label.strip()] = value.strip()
    return facts


def facts_of(result):
    """The call's facts, one per field, without empty or "not stated" ones; selects only with a known option."""
    seen = {}
    for fact in result.get('facts') or []:
        field, value = fact.get('field'), (fact.get('value') or '').strip()
        if field not in FACTS or field in seen or NOT_STATED.match(value):
            continue
        column = FACTS[field][1]
        if column in SELECT_OPTIONS:
            value = next((o for o in SELECT_OPTIONS[column] if _norm(o) == _norm(value)), '')
            if not value:
                continue
        seen[field] = {'field': field, 'label': FACTS[field][0], 'value': value[:300], 'quote': (fact.get('quote') or '').strip()[:300]}
    return list(seen.values())


def merge_facts(app, result):
    """What the call adds to the application. Pure. Empty fields are filled; a field that already says the same
    (or more) is left; a value the call makes more specific ("Remote" -> "Remote, Europe") is refined; a different
    value is never overwritten: it's reported. Returns
    {'changes': Notion properties, 'filled': [fact], 'differs': [fact + 'current'], 'same': [fact]}."""
    props = (app or {}).get('properties', {})
    merged = {'changes': {}, 'filled': [], 'differs': [], 'same': []}
    known = _call_facts(plain(props.get('Call facts')) or '')
    added = dict(known)
    for fact in facts_of(result):
        label, column, kind = FACTS[fact['field']]
        current = known.get(label, '') if kind == 'fact' else (plain(props.get(column)) or '')
        if not current:
            merged['filled'].append(fact)
            if kind == 'fact':
                added[label] = fact['value']
            elif kind == 'select':
                merged['changes'][column] = {'select': {'name': fact['value']}}
            else:
                merged['changes'][column] = {'rich_text': [{'text': {'content': fact['value'][:2000]}}]}
        elif _norm(fact['value']) == _norm(current) or _norm(fact['value']) in _norm(current):
            merged['same'].append(fact)
        elif kind == 'text' and _norm(current) in _norm(fact['value']):
            # The job says less than the call ("Remote" -> "Remote, Europe"): a refinement, not a contradiction.
            merged['filled'].append(dict(fact, refined=current))
            merged['changes'][column] = {'rich_text': [{'text': {'content': fact['value'][:2000]}}]}
        else:
            merged['differs'].append(dict(fact, current=current))
    if added != known:
        text = ' · '.join(f'{label}: {value}' for label, value in added.items())
        merged['changes']['Call facts'] = {'rich_text': [{'text': {'content': text[:2000]}}]}
    return merged


def fact_lines(result, merged=None):
    """One line per fact for the review page: the value, the quote, and what happened on the job."""
    filled = {f['field'] for f in (merged or {}).get('filled', [])}
    differs = {f['field']: f['current'] for f in (merged or {}).get('differs', [])}
    lines = []
    for fact in facts_of(result):
        line = f"{fact['label']}: {fact['value']}" + (f' — “{fact["quote"]}”' if fact['quote'] else '')
        if fact['field'] in differs:
            line += f" ⚠️ Different from the job (it says “{differs[fact['field']]}”): not changed, update it in Notion if the call is right."
        elif fact['field'] in filled:
            line += ' (added to the job)'
        lines.append(line)
    return lines
