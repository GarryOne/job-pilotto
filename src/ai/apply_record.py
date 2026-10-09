"""A form fill's run in the active store (src/stores agent_runs): its record in the spec's shape, and the learnings
earlier runs left, for apply_run.py on any store (Notion, or this Mac's).

Shape (docs/superpowers/specs/2026-10-09-store-adapters.md §4 "Agent run shapes"): fields.data = {fields: [{label,
required, source, outcome, confidence, reason}], left_for_you, attachments, steps: [{step, ms}]}, labels only, never the
person's answers; learnings is the record's own field. On this Mac's store the app already records an Apply with Claude
session (desktop/lib/session-runs.js, ats 'Claude'): the engine updates that record instead of adding a second one.
Guarded by tests/test_apply_record.py.
"""
from datetime import datetime, timedelta

from ..notion import runs
from ..stores import base

APP_SESSION_ATS = 'Claude'   # how the app's session record names itself on this Mac (session-runs.js AGENT)
SAME_SESSION = timedelta(hours=6)
DATA_FIELDS = 200            # a form's rows kept in data (size cap)


def _at(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None


def steps(state):
    """[{step, ms}]: each step's time since the one before it (the first: since the run started)."""
    out, previous = [], _at(state.get('started_at'))
    for item in state.get('steps') or []:
        at = _at(item.get('at'))
        if not at or not previous:
            continue
        out.append({'step': item.get('name') or '?', 'ms': max(0, int((at - previous).total_seconds() * 1000))})
        previous = at
    return out


def data(state, result):
    result = result or {}
    rows = [{'label': f.get('label') or '?', 'required': bool(f.get('required')), 'source': f.get('source') or '',
             'outcome': 'filled' if f.get('observed') and f.get('matches_source') else 'check',
             'confidence': f.get('confidence') or '', 'reason': f.get('reason') or ''}
            for f in result.get('fields') or []][:DATA_FIELDS]
    return {'fields': rows, 'left_for_you': list(state.get('unanswered') or result.get('unanswered') or []),
            'attachments': [a.get('label') or 'file' for a in result.get('attachments') or [] if a.get('present')],
            'steps': steps(state)}


def record(state, result, app=None, learning=''):
    """The agent run record of one fill (state and result as apply_run keeps them)."""
    extras = {'company': (app or {}).get('company') or '', 'job': (app or {}).get('id') or '',
              'agent': runs.AGENT_NAMES.get(state.get('agent', 'codex'), 'Manual'),
              'status': runs.STATUS_NAMES.get(state.get('status'), 'Failed'), 'reason': state.get('reason') or '',
              'started': state.get('started_at') or '', 'ended': state.get('updated_at') or '',
              'minutes': state.get('minutes'), 'field_count': state.get('field_count', len((result or {}).get('fields') or [])),
              'unfilled_required': len(state.get('unanswered') or []), 'billed_to': state.get('billed_to') or 'Unknown',
              'tokens_total': state.get('tokens_total'), 'output_tokens': state.get('tokens_output'), 'data': data(state, result)}
    return {'url': state['url'], 'ats': runs.ats_name(state['url']), 'learnings': learning or '',
            'fields': {key: value for key, value in extras.items() if value not in (None, '')}}


def _app_session(stores, state):
    """The app's own record of this Apply with Claude session on this Mac's store, or None."""
    if stores.name == 'notion' or state.get('agent') != 'claude':
        return None
    started = _at(state.get('started_at'))
    key = base.url_key(state['url'])
    for run in stores.agent_runs.list(ats=APP_SESSION_ATS):
        made = _at(run.get('created_at'))
        if base.url_key(run['url']) == key and (not started or not made or abs(made - started) <= SAME_SESSION):
            return run
    return None


def log(stores, state, result, learning=''):
    """Writes the fill's run; returns its link or store ref (never raises: the local record still counts)."""
    try:
        app = stores.applications.get(state['url'])
        made = record(state, result, app, learning)
        found = _app_session(stores, state)
        if found:  # the app's session record: add the engine's findings, keep its own name and numbers
            fields = {**made['fields'], **(found.get('fields') or {})}
            fields['data'] = made['fields']['data']
            row = stores.agent_runs.update(found['id'], {'learnings': made['learnings'] or found.get('learnings', ''), 'fields': fields})
        else:
            row = stores.agent_runs.add(made)
        return stores.link_or_ref('agent_runs', row['id'])
    except Exception as error:  # noqa: BLE001 — a store that refuses never fails the run
        print(f'Warning: Agent Runs not updated: {type(error).__name__}: {error}')
        return None


def learnings(stores, board=None, limit=12):
    """[(date, ATS, company, agent, learning)] newest first, only runs that recorded a learning."""
    out = []
    for run in stores.agent_runs.list(ats=board or None):
        if run.get('learnings'):
            extras = run.get('fields') or {}
            out.append(((run.get('created_at') or '')[:10], run.get('ats') or '', extras.get('company') or '',
                        extras.get('agent') or '', run['learnings']))
    return sorted(out, reverse=True)[:limit]
