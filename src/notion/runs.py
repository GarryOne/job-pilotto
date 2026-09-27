"""Notion "🤖 Agent Runs": one row per form-filling session, and the learnings read back from it.

A run row links to its job's Applications row and carries agent, job board, status, timings and a
one-line learning. The page body holds the per-step timing and the field-by-field report — labels
and ✓/CHECK only, never applicant values. Agents read recent learnings before filling
(`python3 -m src.ai.apply_run --learnings`), so each run makes the next one better.
"""
from datetime import datetime
import os

from ..sources import ats

RUNS_DATABASE_ID = os.getenv('NOTION_AGENT_RUNS_DB', '')
ATS_NAMES = {'greenhouse': 'Greenhouse', 'ashby': 'Ashby', 'lever': 'Lever', 'workable': 'Workable'}
STATUS_NAMES = {'ready': 'Ready', 'needs_user': 'Needs input', 'failed': 'Failed'}
AGENT_NAMES = {'claude': 'Claude', 'codex': 'Codex', 'chatgpt': 'ChatGPT', 'manual': 'Manual'}


def ats_name(url):
    found = ats.detect(url)
    return ATS_NAMES.get(found[0], 'Other') if found else 'Other'


def _text(value):
    return {'rich_text': [{'text': {'content': (value or '')[:2000]}}]} if value else {'rich_text': []}


def _para(content, kind='paragraph'):
    return {'object': 'block', 'type': kind, kind: {'rich_text': [{'text': {'content': content[:2000]}}]}}


def step_lines(steps, started):
    """'map · +0:05 (5 s)' per step, from [{"name", "at": ISO}] in order."""
    lines, previous = [], started
    for step in steps or []:
        try:
            at = datetime.fromisoformat(str(step['at']).replace('Z', '+00:00'))
        except (KeyError, ValueError, TypeError):
            continue
        offset = int((at - started).total_seconds())
        took = int((at - previous).total_seconds())
        lines.append(f"{step.get('name', '?')} · +{offset // 60}:{offset % 60:02d} ({took} s)")
        previous = at
    return lines


def run_page(state, result, job_row=None, learning=''):
    """(properties, children) for one Agent Runs row."""
    props = (job_row or {}).get('properties', {})
    plain = lambda name, kind: ''.join(t.get('plain_text', '') for t in (props.get(name) or {}).get(kind, []))
    title, company = plain('Job', 'title') or state['url'], plain('Company', 'rich_text')
    agent = AGENT_NAMES.get(state.get('agent', 'codex'), 'Manual')
    started = datetime.fromisoformat(state['started_at'])
    properties = {
        'Run': {'title': [{'text': {'content': f'{company or ats_name(state["url"])} · {title} · {agent}'[:2000]}}]},
        'Job URL': {'url': state['url']},
        'Company': _text(company),
        'Agent': {'select': {'name': agent}},
        'ATS': {'select': {'name': ats_name(state['url'])}},
        'Status': {'select': {'name': STATUS_NAMES.get(state['status'], 'Failed')}},
        'Started': {'date': {'start': state['started_at']}},
        'Ended': {'date': {'start': state['updated_at']}},
        'Minutes': {'number': state.get('minutes')},
        'Fields': {'number': state.get('field_count', len((result or {}).get('fields', [])))},
        'Unfilled required': {'number': len(state.get('unanswered') or [])},
        'Reason': _text(state.get('reason')),
        'Learnings': _text(learning),
        'Billed to': {'select': {'name': state.get('billed_to') or 'Unknown'}},
    }
    for key, name in (('tokens_total', 'Tokens (total)'), ('tokens_output', 'Output tokens')):
        if state.get(key) is not None:
            properties[name] = {'number': state[key]}
    if job_row:
        properties['Job'] = {'relation': [{'id': job_row['id']}]}
    children = [_para('Steps', 'heading_3')]
    children += [_para(line, 'bulleted_list_item') for line in step_lines(state.get('steps'), started)] \
        or [_para('No step timings recorded.')]
    children.append(_para('Fields', 'heading_3'))
    for field in (result or {}).get('fields', []):
        ok = field.get('observed') and field.get('matches_source')
        req = ' (required)' if field.get('required') else ''
        children.append(_para(f"{'✓' if ok else 'CHECK'} {field.get('label', '?')}{req}", 'bulleted_list_item'))
    for item in (result or {}).get('attachments', []):
        children.append(_para(f"{'✓' if item.get('present') else 'CHECK'} attachment: {item.get('label', '?')}",
                              'bulleted_list_item'))
    if learning:
        children += [_para('Learning', 'heading_3'), _para(learning)]
    return properties, children[:95]


def log_run(tracker, state, result, learning=''):
    """Create the Agent Runs row; returns its URL, or None when Notion isn't reachable."""
    properties, children = run_page(state, result, tracker.find(state['url']), learning)
    page = tracker._request('POST', 'pages', {'parent': {'database_id': RUNS_DATABASE_ID},
                                              'properties': properties, 'children': children})
    return page.get('url')


def recent_learnings(tracker, ats_filter=None, limit=12):
    """[(date, ATS, company, agent, learning)] newest first, only runs that recorded a learning."""
    conditions = [{'property': 'Learnings', 'rich_text': {'is_not_empty': True}}]
    if ats_filter:
        conditions.append({'property': 'ATS', 'select': {'equals': ats_filter}})
    rows = tracker.query_database(RUNS_DATABASE_ID, {'and': conditions})
    out = []
    for row in rows:
        p = row['properties']
        text = lambda name: ''.join(t.get('plain_text', '') for t in (p.get(name) or {}).get('rich_text', []))
        select = lambda name: ((p.get(name) or {}).get('select') or {}).get('name', '')
        out.append((row.get('created_time', '')[:10], select('ATS'), text('Company'), select('Agent'),
                    text('Learnings')))
    return sorted(out, reverse=True)[:limit]
