#!/usr/bin/env python3
"""The application record's pieces: matching the Applications row, reading the agent run and CV version, choosing
the channel, building the record and its Notion blocks. `record()` itself (which reads the form snapshot and run files)
stays in src/notion/ledger.py. Re-exported there.

Guarded by tests/test_ledger.py."""
import hashlib
import json
import re
from pathlib import Path

from . import client as notion
from ..sources import ats
from .ledger_blocks import _block, _chunks, _day, _key, _text, plain


RECORD_HEADING = '🗂 Application record'
RECORD_VERSION = 1
# Job sites where a recruiter platform, not the employer, runs the process (Company = real employer, Via = platform).
RECRUITER_PLATFORMS = {'techtree.dev': 'TechTree'}
ATS_NAMES = {'greenhouse': 'Greenhouse', 'ashby': 'Ashby', 'lever': 'Lever', 'workable': 'Workable'}
AGENTS = {'claude': 'Claude', 'codex': 'Codex', 'chatgpt': 'ChatGPT', 'manual': 'Manual'}
SELECTS = {'Seniority': {'Junior', 'Mid', 'Senior', 'Staff/Principal', 'Lead/Manager'},
           'Work mode': {'On-site', 'Hybrid', 'Remote'}, 'Tier': {'A', 'B', 'C'}}


def run_from_notion(tracker, row):
    """The latest 🤖 Agent Runs row linked to this application, as a run state ({'agent', 'minutes'}),
    for applications filled by an agent whose local run file isn't on this machine (or CI)."""
    latest = None
    for link in (row['properties'].get('Agent runs') or {}).get('relation', []):
        props = {name: plain(prop) for name, prop in tracker._request('GET', f"pages/{link['id']}")['properties'].items()}
        if latest is None or (props.get('Started') or '') > (latest.get('Started') or ''):
            latest = props
    if not latest or not latest.get('Agent'):
        return None
    return {'agent': latest['Agent'].lower(), 'minutes': latest.get('Minutes'), 'status': latest.get('Status')}


def cv_version(path):
    """File name plus a short content hash, so a changed CV shows up as a new version."""
    try:
        digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()[:10]
    except OSError:
        return ''
    return f'{Path(path).name} · {digest}'


def match_for(tracker, url, row=None):
    """The job's Job Matches row (AI stage 1 facts and stage 2 scores) as plain values, or {}. A job you added has
    no Job Matches row (src/ai/added.py): its Applications row's fit columns stand in for it when row is given."""
    rows = tracker.query_database(notion.MATCHES_DATABASE_ID, {'property': 'Job URL', 'url': {'equals': url}})
    if rows:
        return {name: plain(prop) for name, prop in rows[0]['properties'].items()}
    props = (row or {}).get('properties') or {}
    own = {'Score': plain(props.get('Fit score')), **{name: plain(props.get(name)) for name in (*SELECTS, 'Salary')}}
    if plain(props.get('Recruiter')):
        own['Recruiter'] = True
    return {name: value for name, value in own.items() if value not in (None, '')}


def answers_for(kit, form):
    """Questions with the answer sent. With a form snapshot, each field's value plus the kit's draft
    for the same question (so edits to drafts can be studied); otherwise the kit drafts alone."""
    drafts = {_key(a['question']): a for a in (kit or {}).get('answers', [])}
    if form:
        rows = []
        for field in form['fields']:
            draft = drafts.get(_key(field.get('label')))
            rows.append({'question': field.get('label', ''), 'answer': field.get('value', ''),
                         'type': field.get('type', ''), 'required': bool(field.get('required')),
                         'draft': draft['answer'] if draft else None})
        return rows, 'Form'
    if kit and kit.get('answers'):
        return [{'question': a['question'], 'answer': a['answer'], 'draft': a['answer'],
                 'needs_review': a.get('needs_review', False)} for a in kit['answers']], 'Kit draft'
    return [], 'None'


def channel_for(url, match=None):
    """(Channel, Via) guessed from the job URL and the Job Matches recruiter flag."""
    host = re.sub(r'^www\.', '', (re.match(r'https?://([^/]+)', url or '') or [None, ''])[1].lower())
    for domain, name in RECRUITER_PLATFORMS.items():
        if host == domain or host.endswith('.' + domain):
            return 'Recruiter platform', name
    if (match or {}).get('Recruiter'):
        return 'Agency', ''
    return 'Direct', ''


def build(url, row, kit, match, posting, form, run, cv, now):
    """(Applications properties, record dict) for one application. Pure: no I/O."""
    props = row['properties']
    answers, captured = answers_for(kit, form)
    found = ats.detect(url)
    posted, applied = _day(plain(props.get('Posted'))), _day(plain(props.get('Applied on'))) or now.date()
    agent = AGENTS.get(((run or {}).get('agent') or '').lower())
    kit = kit or {}
    variant = kit.get('variant') or (f"v{kit['version']}" if kit.get('version') else '')
    cover = kit.get('cover_letter', '')
    if form and not any(re.search(r'cover', a['question'], re.I) and a['answer'] for a in answers):
        cover = form.get('cover_letter', cover)
    properties = {
        'Recorded': {'date': {'start': now.isoformat(timespec='seconds')}},
        'ATS': {'select': {'name': ATS_NAMES.get(found[0], 'Other') if found else 'Other'}},
        'Cover letter': {'checkbox': bool(cover)},
        'Questions': {'number': len(answers)},
        'Answers captured': {'select': {'name': captured}},
        'CV version': _text(cv),
        'Kit variant': _text(variant),
    }
    if match.get('Score') is not None:
        properties['Fit score'] = {'number': match['Score']}
    for name in SELECTS:
        if match.get(name) in SELECTS[name]:
            properties[name] = {'select': {'name': match[name]}}
    if match.get('Recruiter') is not None:
        properties['Recruiter'] = {'checkbox': bool(match['Recruiter'])}
    if posted:
        properties['Days to apply'] = {'number': max((applied - posted).days, 0)}
    if agent:
        properties['Agent'] = {'select': {'name': agent}}
    if not plain(props.get('Channel')):  # never overwrite what the owner set
        channel, via = channel_for(url, match)
        properties['Channel'] = {'select': {'name': channel}}
        if via and not plain(props.get('Via')):
            properties['Via'] = _text(via)
    record = {
        'version': RECORD_VERSION, 'recorded_at': now.isoformat(timespec='seconds'), 'url': url,
        'job': {'title': plain(props.get('Job')), 'company': plain(props.get('Company')),
                'location': plain(props.get('Location')), 'posted': plain(props.get('Posted')),
                'applied_on': applied.isoformat(), 'ats': found[0] if found else None,
                'description': (posting or {}).get('description', '')},
        'match': match, 'answers_captured': captured, 'answers': answers, 'cover_letter': cover,
        'kit': {k: kit.get(k) for k in ('version', 'model', 'variant', 'highlights', 'check_before_sending')}
               if kit else None,
        'variant': variant,
        'run': {k: run.get(k) for k in ('agent', 'minutes', 'field_count', 'status')} if run else None,
        'cv': cv,
    }
    return properties, record


def _fitted_json(record, limit=100 * 1900):
    """The record as JSON small enough for one code block (100 rich-text items of 1,900 chars).
    Long texts are shortened, never cut mid-JSON: first the description, then each answer."""
    payload = json.dumps(record, ensure_ascii=False)
    for keep in (20_000, 5_000, 0):
        if len(payload) <= limit:
            break
        record = dict(record, job=dict(record['job'], description=record['job']['description'][:keep]))
        payload = json.dumps(record, ensure_ascii=False)
    for keep in (2_000, 500, 100):
        if len(payload) <= limit:
            break
        record = dict(record, answers=[dict(a, answer=(a['answer'] or '')[:keep], draft=(a.get('draft') or '')[:keep])
                                       for a in record['answers']])
        payload = json.dumps(record, ensure_ascii=False)
    return payload


def record_blocks(record):
    """The page-body section: readable summary first, then the full JSON for analysis."""
    job, children = record['job'], []
    note = {'Form': 'Answers read from the form just before Submit.',
            'Kit draft': 'Answers are the kit drafts; edits made in the form before Submit are unknown.',
            'None': 'No answers were captured.'}[record['answers_captured']]
    children.append(_block('paragraph', f"Frozen {record['recorded_at']} for {job['title']} — {job['company']}. {note}"))
    if record['answers']:
        children.append(_block('heading_3', '🧾 Questions and answers'))
        for item in record['answers'][:40]:
            edited = item.get('draft') is not None and item['draft'] != item['answer']
            children.append(_block('paragraph', item['question'] + (' ✏️ edited from draft' if edited else ''), bold=True))
            children.append(_block('paragraph', item['answer'] or '—'))
    if record['cover_letter']:
        children.append(_block('heading_3', '✉️ Cover letter sent'))
        children += [_block('paragraph', p) for p in record['cover_letter'].split('\n\n') if p.strip()][:10]
    children.append(_block('heading_3', 'Machine-readable record'))
    children.append({'object': 'block', 'type': 'code', 'code': {'language': 'json', 'rich_text': [
        {'type': 'text', 'text': {'content': c}} for c in _chunks(_fitted_json(record))]}})
    heading = _block('heading_2', RECORD_HEADING)
    heading['heading_2'].update(is_toggleable=True, children=children)
    return heading
