#!/usr/bin/env python3
"""Interview analysis: a recording, a transcript file or typed notes -> 🎤 Interviews.

The Worker passes the Telegram file id (or the notes text) to a `--mode interview` run; the desktop app
passes a file on the Mac, and optionally the job it belongs to (--job <job URL>). A recording (voice note,
audio or video) is first transcribed on the machine, with speakers, by transcribe.py (open-source models,
free). This module strips subtitle timing (.srt/.vtt), and asks Claude Sonnet 5 in one call to
(1) pick which application the interview belongs to (unless the job was given), from the caption and the transcript, and
(2) pull out the questions by topic, how each was answered, strengths, weak spots, signals from the
interviewers, the next step and what to practise.

The same call (3) pulls out the facts the call revealed about the job (salary, contract, relocation, place,
team, visa, start date), each only when said and with a short quote.

The result is a 🎤 Interviews row linked to the application (analysis plus the full transcript in its
page body) and the application moved on (advance(): the call happened, so a Recruiter lead, Screening or
Interview scheduled is Interviewing now; never back, never a closed stage), with its 📈 Application Events row,
Next step from the review, a past Next interview cleared and the call's facts filled into empty fields (a
different value already there is not overwritten: the review page and the summary show both). Then a Telegram
summary. The daily insight and weekly report read the Interviews rows.
A row reviewed before can be reviewed again from the app (review_again(): the review replaced, only empty fields
of the job filled, no Stage change or event). A recording saved without a review moves the application on the same way (save(), link()); an interview
that wasn't recorded is confirmed from Focus ("Did it happen?": held(), moved(), cancelled()).
Each user's Notion is their own private database; the transcript stays there and in Telegram.
"""
from datetime import datetime, timezone
from html import escape
import json
import os
import re
import sys
import tempfile
from pathlib import Path
import urllib.request

from ..notion import client as notion
from ..notion import titles
from ..notion.titles import named  # noqa: F401 — the one placeholder rule (job titles too)
from ..notion.ledger import EVENTS_DATABASE_ID, add_event, plain
from . import cost, transcribe

# Opus for reviews and the insights built on them (owner, 30 Sep 2026): rare, judgment-heavy calls on noisy transcripts.
# Opus thinks by default (it can't be switched off), so its answers get room: MAX_TOKENS. A request it declines is answered
# once by FALLBACK_MODEL (ask()).
DEFAULT_MODEL = os.getenv('JOB_PILOTTO_INTERVIEW_MODEL', 'claude-opus-5-5')
FALLBACK_MODEL = 'claude-sonnet-5'
MAX_TOKENS = 16000
INTERVIEWS_DATABASE_ID = os.getenv('NOTION_INTERVIEWS_DB', '')
TEXT_TYPES = ('.txt', '.md', '.srt', '.vtt', '.text')
MAX_CHARS = 180_000  # about 3 hours of speech, within Notion's request size; longer files are cut, with a note
# Stages an interview can move an application forward from; later stages are never overwritten.
BEFORE_INTERVIEW = ('Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Applying', 'No response',
                    'Recruiter lead')
CANDIDATE_STAGES = BEFORE_INTERVIEW + ('Interviewing', 'Offer', 'Rejected')
# Talking to them, or a call booked: once a call was held, the application is in process (Interviewing).
IN_TALKS = ('Recruiter lead', 'Screening', 'Interview scheduled')
# Never touched by an interview: an offer, or the application is over.
CLOSED = ('Offer', 'Rejected', 'Withdrawn', 'Closed', 'Dismissed')
CANCELLED = 'Interview cancelled'  # 📈 Application Events kind: the call didn't happen (Stage stays)
APP_SOURCE = 'Job Pilotto app'

# Facts a call can reveal about the job -> (label, Applications column, kind). Kind 'text' and 'select' are columns
# of their own; 'fact' lines share the "Call facts" column ("Label: value · Label: value").
FACTS = {
    'salary': ('Salary', 'Salary', 'text'),
    'salary_ask': ('Your ask', 'Call facts', 'fact'),
    'contract': ('Contract', 'Contract', 'select'),
    'location': ('Location', 'Location', 'text'),
    'work_mode': ('Work mode', 'Work mode', 'select'),
    'relocation': ('Relocation', 'Call facts', 'fact'),
    'team_size': ('Team size', 'Call facts', 'fact'),
    'company_size': ('Company size', 'Call facts', 'fact'),
    'visa': ('Visa/permit', 'Call facts', 'fact'),
    'start_date': ('Start date', 'Call facts', 'fact'),
}
SELECT_OPTIONS = {'Contract': ('Employee', 'B2B / contractor', 'Employee or B2B'), 'Work mode': ('On-site', 'Hybrid', 'Remote')}
NOT_STATED = re.compile(r'^\s*(not stated|unknown|none|n/?a|-)?\s*\.?\s*$', re.I)

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['application', 'company', 'round', 'interviewers', 'duration_min', 'questions', 'strengths',
                 'weaknesses', 'signals', 'red_flags', 'next_step', 'practice', 'overall', 'summary', 'facts'],
    'properties': {
        'application': {'type': 'integer', 'description': 'Index of the matching application in the list, or -1 if unclear'},
        'company': {'type': 'string', 'description': 'The employer exactly as named in the caption or transcript; "" when it is not named '
                                                     '(never a description, never "unnamed ...", never a guess)'},
        'round': {'type': 'string', 'description': 'e.g. "Recruiter screen", "Technical 1", "System design", "Hiring manager"'},
        'interviewers': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Roles only (e.g. "SRE manager"), no names'},
        'duration_min': {'type': 'integer', 'description': 'Estimated from timestamps, or 0 if unknown'},
        'questions': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False,
            'required': ['topic', 'question', 'answer', 'quality', 'better'],
            'properties': {
                'topic': {'type': 'string', 'description': 'Short topic label, e.g. "Kubernetes networking", "Incident response", "Motivation"'},
                'question': {'type': 'string'},
                'answer': {'type': 'string', 'description': "One-line gist of the candidate's answer"},
                'quality': {'type': 'string', 'enum': ['strong', 'ok', 'weak', 'not_answered']},
                'better': {'type': 'string', 'description': 'For ok/weak answers: what a stronger answer would add; else ""'},
            }}},
        'strengths': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 4, each with evidence'},
        'weaknesses': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 4, each with evidence'},
        'signals': {'type': 'array', 'items': {'type': 'string'},
                    'description': 'What they revealed: team, salary range, process, concerns, enthusiasm'},
        'red_flags': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Anything the candidate said that could count against them'},
        'next_step': {'type': 'string', 'description': 'What happens next, as stated, or "not stated"'},
        'practice': {'type': 'array', 'items': {'type': 'string'}, 'description': '1-3 concrete things to practise before the next round'},
        'overall': {'type': 'string', 'enum': ['positive', 'neutral', 'negative']},
        'summary': {'type': 'string', 'description': '2-3 sentences'},
        'facts': {'type': 'array', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['field', 'value', 'quote'],
            'properties': {
                'field': {'type': 'string', 'enum': list(FACTS)},
                'value': {'type': 'string', 'description': 'The fact, short (see the rules for each field)'},
                'quote': {'type': 'string', 'description': 'The words said in the call, verbatim, at most 20 words'},
            }}, 'description': 'Facts about the job the call revealed; only what was actually said, each field at most once'},
    },
}

SYSTEM = """You review job interviews for the candidate (the owner of Job Pilotto). You get the candidate's \
profile, the list of their applications, the caption they wrote, and a transcript or their own notes.

- Identify the application from the caption first, then the transcript (company, role). If two \
applications at the same company fit, prefer the one in an interview stage or applied most recently. \
Use -1 when you can't tell.
- company: the employer's name only when the call or caption names it; otherwise an empty string. Never a \
description, never "unnamed ...", never a guess (a recruiter may not name the client).
- The transcript may not label speakers. Infer who is the candidate from context (the profile helps).
- Be honest and specific. "weak" means the answer missed what the question was probing, was vague, or \
was wrong; say what a stronger answer would add, using the candidate's real experience from the profile.
- Only report what the transcript supports. Notes written by the candidate are their own recollection; \
say less when the input is thin.
- Interviewers by role only; never names.
- facts: only what someone actually said in this call, never guesses or the posting. salary = the employer's \
range or offer, with currency and period (e.g. "150-170k/year gross", in the currency said); salary_ask = what the candidate asked \
for, same format; contract = exactly "Employee", "B2B / contractor" or "Employee or B2B"; work_mode = exactly \
"On-site", "Hybrid" or "Remote"; location = a SHORT summary, at most about five words (e.g. "Hybrid, 2 days in office", "Remote, one region"), \
never conditions: who can be employed where, through which setup, or relocation terms belong in relocation; relocation, \
team_size, company_size, visa (work permit/sponsorship), start_date = short, as said.

The candidate's profile follows.

"""


def download(token, file_id, opener=urllib.request.urlopen):
    """(file name, bytes) of a Telegram document, audio or voice note, via getFile (bots: up to 20 MB)."""
    with opener(f'https://api.telegram.org/bot{token}/getFile?file_id={file_id}', timeout=20) as response:
        info = json.load(response)
    if not info.get('ok'):
        raise RuntimeError(info.get('description', 'Telegram getFile failed'))
    path = info['result']['file_path']
    with opener(f'https://api.telegram.org/file/bot{token}/{path}', timeout=60) as response:
        raw = response.read()
    return path.rsplit('/', 1)[-1], raw


def clean(text):
    """Subtitle files (.srt/.vtt) without cue numbers, timings and repeated lines; plain text as is."""
    if not re.search(r'\d\d:\d\d[:.]\d\d[.,]\d{3}\s*-->', text):
        return text.strip()
    lines, last = [], None
    for line in text.splitlines():
        line = line.strip()
        if not line or line == 'WEBVTT' or line.isdigit() or '-->' in line or line.startswith(('NOTE', 'Kind:', 'Language:')):
            continue
        line = re.sub(r'<[^>]+>', '', line)
        if line != last:
            lines.append(line)
        last = line
    return '\n'.join(lines)


def candidates(tracker):
    rows = tracker.query_database(tracker.database_id, {'or': [
        {'property': 'Stage', 'select': {'equals': stage}} for stage in CANDIDATE_STAGES]})
    return sorted(rows, key=lambda r: plain(r['properties'].get('Applied on')) or '', reverse=True)


def ask(client, model, **request):
    """One structured call; when `model` declines it (stop_reason "refusal"), the same request once on FALLBACK_MODEL.
    Returns (parsed JSON, usage, the model that answered): cost is counted at that model's price."""
    response = client.messages.create(model=model, **request)
    if response.stop_reason == 'refusal' and model != FALLBACK_MODEL:
        print(f'Warning: {model} declined; asking {FALLBACK_MODEL}', file=sys.stderr)
        model = FALLBACK_MODEL
        response = client.messages.create(model=model, **request)
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    return json.loads(next(block.text for block in response.content if block.type == 'text')), response.usage, model


def analyse(client, model, profile, apps, caption, transcript):
    listing = '\n'.join(
        f"{i}. {plain(r['properties'].get('Company'))} — {titles.row_role(r)} "
        f"(stage {plain(r['properties'].get('Stage'))}, applied {plain(r['properties'].get('Applied on')) or '?'})"
        for i, r in enumerate(apps))
    return ask(client, model, max_tokens=MAX_TOKENS,
               system=[{'type': 'text', 'text': SYSTEM + profile}],
               messages=[{'role': 'user', 'content': f'Applications:\n{listing or "(none)"}\n\nCaption: {caption or "(none)"}\n\n'
                                                     f'Transcript or notes:\n{transcript}'}],
               output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}, 'effort': 'medium'})


def _block(kind, content, bold=False):
    chunks = [content[i:i + 1900] for i in range(0, len(content), 1900)] or ['']
    return {'object': 'block', 'type': kind, kind: {'rich_text': [
        {'type': 'text', 'text': {'content': c}, 'annotations': {'bold': bold}} for c in chunks[:100]]}}


NO_JOB = 'No job linked yet — link it in the Interviews page of the Job Pilotto app'


def job_line(app):
    """The visible first line of an interview page: "🔗 Job: <link to the Application> · company · title", or a hint."""
    if not app:
        return _block('paragraph', f'🔗 {NO_JOB}')
    props = app.get('properties', {})
    who = plain(props.get('Company')) or plain(props.get('Via')) or 'Job'
    title = titles.row_role(app)  # the role: who is already said
    url = app.get('url') or f"https://www.notion.so/{app['id'].replace('-', '')}"
    text = lambda content, link=None: {'type': 'text', 'text': {'content': content, **({'link': dict(url=url)} if link else {})}}
    return {'object': 'block', 'type': 'paragraph', 'paragraph': {'rich_text': [
        text('🔗 Job: '), text(f'{who} · {title}' if title else who, link=True)]}}


def _line_key(rich_text):
    return [(t.get('text', {}).get('content', t.get('plain_text', '')), (t.get('text', {}).get('link') or {}).get('url')) for t in rich_text]


def ensure_job_line(tracker, page_id, app):
    """Keep the job line at the top of an interview page, once: replaced when it is there (the first three blocks),
    else put first. Returns True when the page changed."""
    want = job_line(app)['paragraph']['rich_text']
    blocks = tracker._children(page_id)
    for block in blocks[:3]:
        if block['type'] == 'paragraph' and plain({'type': 'rich_text', 'rich_text': block['paragraph'].get('rich_text', [])}).startswith('🔗 '):
            if _line_key(block['paragraph']['rich_text']) == _line_key(want):
                return False
            tracker._request('PATCH', f"blocks/{block['id']}", {'paragraph': {'rich_text': want}})
            return True
    first = blocks[0] if blocks else None
    if first and first['type'] == 'paragraph' and not first.get('children') and not first.get('has_children'):
        # The API can't insert before a block: the first paragraph becomes the line and its old text goes right after.
        old = first['paragraph'].get('rich_text', [])
        tracker._request('PATCH', f"blocks/{first['id']}", {'paragraph': {'rich_text': want}})
        tracker._request('PATCH', f"blocks/{page_id}/children", {'children': [{'object': 'block', 'type': 'paragraph', 'paragraph': {'rich_text': old}}], 'after': first['id']})
    else:
        tracker._request('PATCH', f"blocks/{page_id}/children", {'children': [job_line(app)], **({'after': first['id']} if first else {})})
    return True


def transcript_toggle(transcript):
    toggle = _block('heading_3', 'Transcript')
    paragraphs = [transcript[i:i + 190_000] for i in range(0, len(transcript), 190_000)] or ['']
    toggle['heading_3'].update(is_toggleable=True, children=[_block('paragraph', p) for p in paragraphs])
    return toggle


def analysis_blocks(result, merged=None):
    """The review: summary, strengths, weak spots, signals, facts from the call, practice and every question.
    merged (merge_facts) marks each fact as filled on the job or different from it. At most 94 blocks."""
    marks = {'strong': '✅', 'ok': '➖', 'weak': '⚠️', 'not_answered': '❌'}
    blocks = [_block('paragraph', result['summary'])]
    for title, items in (('Strengths', result['strengths']), ('Weak spots', result['weaknesses']),
                         ('Signals from them', result['signals']), ('Could count against you', result['red_flags']),
                         ('Facts from the call', fact_lines(result, merged)),
                         ('Practise before the next round', result['practice'])):
        if items:
            blocks += [_block('heading_3', title)] + [_block('bulleted_list_item', item) for item in items[:10]]
    blocks.append(_block('heading_3', 'Questions'))
    for q in result['questions'][:20]:
        text = f"{marks.get(q['quality'], '')} [{q['topic']}] {q['question']} — {q['answer']}"
        blocks.append(_block('bulleted_list_item', text + (f" → Better: {q['better']}" if q['better'] else '')))
    return blocks[:94]


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


def page_blocks(result, transcript, merged=None):
    """Analysis first, then the full transcript in a toggle (within Notion's 100 blocks per request)."""
    return analysis_blocks(result, merged) + [transcript_toggle(transcript)]


def interview_title(company, round_, app=None):
    """"Company · Round": the employer if named (in the call, else the application's Company), else the application's
    Via (agency), else its job title, else just the round."""
    props = (app or {}).get('properties', {})
    name = (named(company) or named(plain(props.get('Company'))) or named(plain(props.get('Via')))
            or named(titles.row_role(app)))
    return ' · '.join(part for part in (name, (round_ or '').strip()) if part)[:200] or 'Interview'


def properties(result, app, today, model, usd, source):
    """source: 'Recording', 'Transcript' or 'Notes' (older callers pass True/False for transcript/notes)."""
    source = {True: 'Transcript', False: 'Notes'}.get(source, source)
    text = lambda value: {'rich_text': [{'text': {'content': value[:2000]}}]}
    topics = list(dict.fromkeys(q['topic'] for q in result['questions']))
    weak = list(dict.fromkeys(q['topic'] for q in result['questions'] if q['quality'] in ('weak', 'not_answered')))
    props = {
        'Interview': {'title': [{'text': {'content': interview_title(result['company'], result['round'], app)}}]},
        'Date': {'date': {'start': today.isoformat()}},
        'Round': text(result['round']),
        'Overall': {'select': {'name': result['overall']}},
        'Questions': {'number': len(result['questions'])},
        'Weak answers': {'number': sum(q['quality'] in ('weak', 'not_answered') for q in result['questions'])},
        'Topics': text('; '.join(topics)),
        'Weak topics': text('; '.join(weak)),
        'Next step': text(result['next_step']),
        'Input': {'select': {'name': source}},
        'Cost (USD)': {'number': round(usd, 4)},
        'Model': text(model),
    }
    if app:
        props['Application'] = {'relation': [{'id': app['id']}]}
    return props


def message(result, app, page_url, usd, truncated=False, merged=None, stage=None):
    title = (f"{escape(plain(app['properties'].get('Company')) or '')} — {escape(titles.row_role(app))}"
             if app else f"{escape(named(result['company']) or 'Unknown company')} (not linked to an application)")
    weak = [q for q in result['questions'] if q['quality'] in ('weak', 'not_answered')]
    lines = [f"🎤 <b>Interview · {escape(result['round'])}</b>", title, '', escape(result['summary'])]
    if result['strengths']:
        lines += ['', '✅ <b>Strong</b>'] + [f'• {escape(s)}' for s in result['strengths'][:3]]
    if weak:
        lines += ['', f'⚠️ <b>Weak answers ({len(weak)} of {len(result["questions"])})</b>'] + [
            f"• {escape(q['topic'])}: {escape(q['better'] or q['question'])}" for q in weak[:3]]
    if result['practice']:
        lines += ['', '🏋️ <b>Practise</b>'] + [f'• {escape(p)}' for p in result['practice'][:3]]
    lines += ['', f"➡️ Next: {escape(result['next_step'])}"]
    if stage:
        lines.append(f'📈 Stage → {escape(stage)}')
    lines += changes_lines(merged)
    if truncated:
        lines.append('<i>The transcript was very long; only the first part was analysed.</i>')
    if not app:
        lines.append('<i>Link it to its application in Notion (Application column).</i>')
    lines.append(f'<a href="{escape(page_url, quote=True)}">Full analysis and transcript</a> · ${usd:.3f}')
    return '\n'.join(lines)


def changes_lines(merged):
    """What the call filled on the job, and where it said something else (Telegram lines)."""
    if not merged:
        return []
    lines = []
    if merged['filled']:
        lines.append('📋 Added to the job: ' + escape('; '.join(f"{f['label']}: {f['value']}" for f in merged['filled'])))
    for fact in merged['differs']:
        lines.append(f"⚠️ {escape(fact['label'])}: the call said “{escape(fact['value'])}”, the job says "
                     f"“{escape(fact['current'])}” (not changed)")
    return lines


def changes_summary(merged, stage=None):
    """The same, short, for the run's one-line result (the app shows it after a review)."""
    parts = [f'stage → {stage}'] if stage else []
    if merged and merged['filled']:
        parts.append('filled ' + ', '.join(f"{f['label']} ({f['value'][:40]})" for f in merged['filled']))
    if merged and merged['differs']:
        parts.append('differs from the job, not changed: ' + ', '.join(
            f"{f['label']} (call: {f['value'][:40]}; job: {f['current'][:40]})" for f in merged['differs']))
    return '; '.join(parts)


SCREEN = re.compile(r'screen|recruiter|talent|phone|intro', re.I)


def held_stage(stage, round_=''):
    """The Stage once an interview was held, or None to leave it: never a closed stage, never back from Interviewing.
    A recruiter/screening round held is Screening (owner, 30 Sep 2026: the funnel's "Interviews" step starts with a
    technical or hiring-manager round), even when the call was booked as "Interview scheduled"; any other round is
    Interviewing."""
    if stage in CLOSED or stage == 'Interviewing':
        return None
    if SCREEN.search(round_ or ''):
        return None if stage == 'Screening' else 'Screening'
    return 'Interviewing'


def _moment(value):
    try:
        moment = datetime.fromisoformat((value or '').replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _events_of(tracker, app):
    page = app['id'].replace('-', '')
    return [e for e in tracker.query_database(EVENTS_DATABASE_ID)
            if any(l['id'].replace('-', '') == page for l in (e['properties'].get('Application') or {}).get('relation', []))]


def advance(tracker, app, *, now=None, round_='', next_step='', changes=None, note='', source='Telegram', clear_past=True):
    """An interview of this application was held: Stage forward (held_stage), a 📈 Application Events row of that
    kind unless one exists (a review is often sent days after the call, which was usually logged already), Next
    step from the review, a past Next interview cleared (clear_past), plus `changes` (the call's facts), in one
    Notion update. An application at a closed stage (Offer, Rejected, …) is left alone. Returns the new Stage or None."""
    now = now or datetime.now(timezone.utc)
    stage = plain(app['properties'].get('Stage')) or ''
    if stage in CLOSED:
        return None
    target = held_stage(stage, round_)
    kind = target or ('Screening' if SCREEN.search(round_ or '') else 'Interviewing')  # what was held
    if not any(plain(e['properties'].get('Kind')) == kind for e in _events_of(tracker, app)):
        add_event(tracker, app, kind, source, note=note)
    update = dict(changes or {})
    if target:
        update['Stage'] = {'select': {'name': target}}
    if next_step and not NOT_STATED.match(next_step):
        update['Next step'] = {'rich_text': [{'text': {'content': next_step[:2000]}}]}
    coming = _moment(plain(app['properties'].get('Next interview')))
    if clear_past and coming and coming <= now:
        update['Next interview'] = {'date': None}
    if update:
        tracker.update_page(app['id'], update)
    return target


def read_input(file_id, token, opener, speakers=0):
    """(file name, transcript text, was it a recording) for a local path or a Telegram file id."""
    if Path(file_id).is_file():
        # The desktop app passes a file from the Mac instead of a Telegram file id.
        name, path, raw = Path(file_id).name, Path(file_id), None
    else:
        name, raw = download(token, file_id, opener)
        path = None
    lower = name.lower()
    if lower.endswith(transcribe.AUDIO_TYPES):
        if not transcribe.available():
            raise ValueError(f'{name}: recordings need the transcription add-on (pip install -r requirements-transcribe.txt); '
                             'or send a text transcript')
        if path:
            return name, transcribe.transcribe(path, speakers), True
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / name
            path.write_bytes(raw)
            return name, transcribe.transcribe(path, speakers), True
    if not lower.endswith(TEXT_TYPES):
        raise ValueError(f'{name}: send a recording ({", ".join(transcribe.AUDIO_TYPES)}) '
                         f'or a text transcript ({", ".join(TEXT_TYPES)})')
    text = path.read_text(encoding='utf-8', errors='replace') if path else raw.decode('utf-8', errors='replace')
    return name, clean(text), False


def application_for(tracker, job_url):
    """The Applications row for a job the owner picked; a job not tracked yet is added (an interview means
    they applied; the date is marked approximate)."""
    app = by_url(tracker, [], job_url)
    if app:
        return app
    from ..notion.ledger import add_application
    add_application(tracker, job_url.strip(), approx=True, source=os.getenv('JOB_PILOTTO_SOURCE') or 'Manual')
    app = by_url(tracker, [], job_url)
    if not app:
        raise ValueError(f'Could not add {job_url} to your Applications')
    return app


def by_url(tracker, apps, job_url):
    """The application with this Job URL: among the candidates, else any stage (the owner chose it)."""
    same = lambda row: (plain(row['properties'].get('Job URL')) or '').strip() == job_url.strip()
    found = next((row for row in apps if same(row)), None)
    if found:
        return found
    rows = tracker.query_database(tracker.database_id, {'property': 'Job URL', 'url': {'equals': job_url.strip()}})
    return rows[0] if rows else None


def run(tracker, *, file_id=None, note='', token=None, send=None, model=DEFAULT_MODEL, client=None,
        now=None, opener=urllib.request.urlopen, stats=None, job_url=None, page_id=None, found=None):
    """Analyse one interview (a recording, a transcript file, or notes text) and record it. Returns a log
    line ending with the 🎤 Interviews page URL. job_url links it to that application instead of guessing.
    page_id reviews a row saved earlier (save()): its transcript is read from Notion, the review is added
    to that page and its Application is kept unless job_url changes it. A row already reviewed is reviewed again
    (review_again). found (a dict) gets the reviewed job's Applications row id as 'application', once known."""
    now = now or datetime.now(timezone.utc)
    caption, transcript, recorded = note, '', False
    saved = tracker._request('GET', f'pages/{page_id}') if page_id else None
    # A row that already has a review (Overall set) is reviewed again: see review_again() below.
    again = bool(saved and plain(saved['properties'].get('Overall')))
    if saved:
        transcript = saved_transcript(tracker, page_id)
        caption = note or plain(saved['properties'].get('Interview'))
        recorded = plain(saved['properties'].get('Input')) == 'Recording'
        linked = [r['id'] for r in (saved['properties'].get('Application') or {}).get('relation', [])]
    elif file_id:
        _, transcript, recorded = read_input(file_id, token, opener)
    else:
        # "/interview <caption line>\n<notes>" — the first line names the interview, the rest is notes.
        body = re.sub(r'^/interview(@\w+)?\s*', '', note or '')
        caption, _, transcript = body.partition('\n')
        transcript = transcript.strip() or caption
    if len(transcript.strip()) < 40:
        raise ValueError('Too little text to analyse. Send the recording or transcript file, or /interview <company, round> '
                         'with your notes on the next lines.')
    truncated = len(transcript) > MAX_CHARS
    transcript = transcript[:MAX_CHARS]
    apps = candidates(tracker)
    chosen = (by_url(tracker, apps, job_url) or application_for(tracker, job_url)) if job_url else None
    if saved and not chosen and linked:
        chosen = next((row for row in apps if row['id'] == linked[0]), None) or tracker._request('GET', f'pages/{linked[0]}')
    if chosen and chosen not in apps:
        apps = [chosen] + apps
    if client is None:
        from . import engine
        client = engine.client(action='interview')
    result, usage, model = analyse(client, model, tracker.page_text(), apps, caption, transcript)
    cost.add(stats, model, usage)
    usd = cost.usd(model, usage)
    app = chosen or (apps[result['application']] if 0 <= result['application'] < len(apps) else None)
    if again:  # a review again: the row keeps its job; no guess links it elsewhere
        app = chosen
    if app and found is not None:
        found['application'] = app['id']
    if found is not None:  # the interview's title, for the run's ("Huxley · Recruiter screen"); a review again keeps its own
        found['title'] = (plain(saved['properties'].get('Interview')) if again else '') or \
            interview_title(result['company'], result['round'], app)
    source = (plain(saved['properties'].get('Input')) or 'Transcript') if saved else (
        'Recording' if recorded else 'Transcript' if file_id else 'Notes')
    props = properties(result, app, now.date(), model, usd, source)
    # An application at a closed stage is never touched: its facts are only listed on the review.
    merged = merge_facts(app, result) if app and plain(app['properties'].get('Stage')) not in CLOSED else None
    if again:
        return review_again(tracker, page_id, saved, result, app, merged, props, usd, send, truncated)
    if saved:
        props.pop('Date')  # the day it was held, set when it was saved
        page = tracker._request('PATCH', f'pages/{page_id}', {'properties': props})
        add_review(tracker, page_id, analysis_blocks(result, merged))
        ensure_job_line(tracker, page_id, app)
    else:
        page = tracker._request('POST', 'pages', {'parent': {'database_id': INTERVIEWS_DATABASE_ID},
                                                  'properties': props,
                                                  'children': [job_line(app)] + page_blocks(result, transcript, merged)})
    stage = None
    if app:
        stage = advance(tracker, app, now=now, round_=result['round'], next_step=result['next_step'],
                        changes=(merged or {}).get('changes'), note=f"{result['round']}: {result['overall']}")
    if send:
        send(message(result, app, page.get('url', ''), usd, truncated, merged, stage))
    where = f"{plain(app['properties'].get('Company')) or plain(app['properties'].get('Via')) or 'linked'}" if app else 'unlinked'
    extra = changes_summary(merged, stage)
    return (f"Interview analysed ({where}, {result['round']}, {len(result['questions'])} questions, ${usd:.3f})"
            f"{f'. {extra[0].upper()}{extra[1:]}' if extra else ''} {page.get('url', '')}").strip()


def review_again(tracker, page_id, saved, result, app, merged, props, usd, send=None, truncated=False):
    """The Interviews page's "Review again" (a row reviewed before, e.g. before facts were extracted): the review
    sections are replaced (replace_review), the row keeps its title, date, input and job link, its Cost adds this
    call's, and the job gets only what it lacks: the call's facts in EMPTY fields (merge_facts) and Next step when
    it's empty. No Stage change, no event, no Next interview cleared: the call was held and counted at the first
    review. Running it twice changes nothing on the job the second time."""
    for kept in ('Date', 'Interview', 'Input', 'Application'):
        props.pop(kept, None)
    before = (saved['properties'].get('Cost (USD)') or {}).get('number') or 0
    props['Cost (USD)'] = {'number': round(before + usd, 4)}
    replace_review(tracker, page_id, analysis_blocks(result, merged))  # first: a failure leaves the old review whole
    page = tracker._request('PATCH', f'pages/{page_id}', {'properties': props})
    ensure_job_line(tracker, page_id, app)
    update = {}
    if app and merged is not None:
        update = dict(merged.get('changes') or {})
        step = result.get('next_step') or ''
        if step and not NOT_STATED.match(step) and not plain(app['properties'].get('Next step')):
            update['Next step'] = {'rich_text': [{'text': {'content': step[:2000]}}]}
        if update:
            tracker.update_page(app['id'], update)
    if send:
        send(message(result, app, page.get('url', '') or saved.get('url', ''), usd, truncated, merged))
    where = f"{plain(app['properties'].get('Company')) or plain(app['properties'].get('Via')) or 'linked'}" if app else 'unlinked'
    extra = '; '.join(filter(None, ('' if (merged or {}).get('filled') or 'Next step' in update else 'nothing new for the job',
                                    changes_summary(merged), 'Next step set' if 'Next step' in update else '')))
    return (f"Interview analysed again ({where}, {result['round']}, {len(result['questions'])} questions, ${usd:.3f})"
            f". {extra[0].upper()}{extra[1:]} {page.get('url', '') or saved.get('url', '')}").strip()


# The headings analysis_blocks() writes: how an earlier review is found on the page to be replaced.
REVIEW_HEADINGS = ('Strengths', 'Weak spots', 'Signals from them', 'Could count against you', 'Facts from the call',
                   'Practise before the next round', 'Questions')


def _plain_block(block):
    return plain({'type': 'rich_text', 'rich_text': block.get(block['type'], {}).get('rich_text', [])}) or ''


def review_block_ids(blocks):
    """The blocks of the review(s) on an interview page: each review's summary (the paragraph right before its first
    heading), its headings and their bullets. The job line, the Transcript toggle and anything else stay."""
    ids, inside = [], False
    for i, block in enumerate(blocks):
        kind = block['type']
        if kind == 'heading_3' and not block[kind].get('is_toggleable') and _plain_block(block) in REVIEW_HEADINGS:
            before = blocks[i - 1] if i else None
            if not inside and before and before['type'] == 'paragraph' and before['id'] not in ids \
                    and not _plain_block(before).startswith('🔗 ') and _plain_block(before) != PLACEHOLDER:
                ids.append(before['id'])
            ids.append(block['id'])
            inside = True
        elif inside and kind == 'bulleted_list_item':
            ids.append(block['id'])
        else:
            inside = False
    return ids


def replace_review(tracker, page_id, blocks):
    """Put a new review where the old one is: added right after it, then the old blocks removed (a failed add leaves
    the old review whole; a second run also clears what a half-done delete left). No review yet: add_review."""
    old = review_block_ids(tracker._children(page_id))
    if not old:
        return add_review(tracker, page_id, blocks)
    tracker._request('PATCH', f'blocks/{page_id}/children', {'children': blocks, 'after': old[-1]})
    for block_id in old:
        tracker._request('DELETE', f'blocks/{block_id}')


PLACEHOLDER = 'Not reviewed yet. Review it from the Interviews page of the Job Pilotto app.'


def save(tracker, transcript, title, *, job_url=None, source='Recording', now=None, page_id=None):
    """A transcript as a 🎤 Interviews row, without AI: title, date, Input, the chosen job, and the
    transcript in the page (a placeholder marks where the review goes). Returns the created page.
    With page_id (the row the app created as soon as the transcript was ready), that row is updated instead:
    title, job, and the transcript toggle replaced by the edited one (speakers named).
    A recorded call was held: the chosen job moves on (advance), keeping a past Next interview until the review,
    so Focus asks to review it."""
    now = now or datetime.now(timezone.utc)
    transcript = transcript.strip()[:MAX_CHARS]
    if len(transcript) < 40:
        raise ValueError('Too little text to save')
    props = {'Interview': {'title': [{'text': {'content': (title or 'Interview')[:200]}}]},
             'Date': {'date': {'start': now.date().isoformat()}}, 'Input': {'select': {'name': source}}}
    app = application_for(tracker, job_url) if job_url else None
    if app:
        props['Application'] = {'relation': [{'id': app['id']}]}
    if page_id:
        props.pop('Date')  # the day it was first saved stays
        if not app:
            props['Application'] = {'relation': []}
        page = tracker._request('PATCH', f'pages/{page_id}', {'properties': props})
        for block in tracker._children(page_id):
            body = block.get(block['type'], {})
            if block['type'] == 'heading_3' and plain({'type': 'rich_text', 'rich_text': body.get('rich_text', [])}) == 'Transcript':
                tracker._request('DELETE', f"blocks/{block['id']}")
        tracker._request('PATCH', f'blocks/{page_id}/children', {'children': [transcript_toggle(transcript)]})
        ensure_job_line(tracker, page_id, app)
    else:
        page = tracker._request('POST', 'pages', {'parent': {'database_id': INTERVIEWS_DATABASE_ID}, 'properties': props,
                                                  'children': [job_line(app), _block('paragraph', PLACEHOLDER), transcript_toggle(transcript)]})
    if app:
        advance(tracker, app, now=now, round_=title, note=f'{source} saved', source=APP_SOURCE, clear_past=False)
    return page


def saved_transcript(tracker, page_id):
    """The transcript kept in a row's "Transcript" toggle."""
    for block in tracker._children(page_id):
        body = block.get(block['type'], {})
        if block['type'] == 'heading_3' and plain({'type': 'rich_text', 'rich_text': body.get('rich_text', [])}) == 'Transcript':
            return ''.join(plain({'type': 'rich_text', 'rich_text': child.get(child['type'], {}).get('rich_text', [])})
                           for child in tracker._children(block['id']))
    raise ValueError('This interview has no transcript in Notion')


def add_review(tracker, page_id, blocks):
    """Put the review where the placeholder is (the top of the page), or at the end if it's gone."""
    marker = next((b for b in tracker._children(page_id) if b['type'] == 'paragraph' and
                   plain({'type': 'rich_text', 'rich_text': b['paragraph'].get('rich_text', [])}) == PLACEHOLDER), None)
    tracker._request('PATCH', f'blocks/{page_id}/children', {'children': blocks, **({'after': marker['id']} if marker else {})})
    if marker:
        tracker._request('DELETE', f"blocks/{marker['id']}")


def link(tracker, page_id, job_url=None):
    """Set (or with no job_url, clear) the application a 🎤 Interviews row belongs to."""
    app = application_for(tracker, job_url) if job_url else None
    tracker.update_page(page_id, {'Application': {'relation': [{'id': app['id']}] if app else []}})
    ensure_job_line(tracker, page_id, app)
    if app:  # a recorded call belongs to this job: it was held
        advance(tracker, app, note='Interview linked', source=APP_SOURCE, clear_past=False)
    return app['id'] if app else None


def delete(tracker, page_id):
    """Move a 🎤 Interviews row to Notion's trash (restorable there for 30 days)."""
    tracker._request('PATCH', f'pages/{page_id}', {'archived': True})


def _place(tracker, page_id, seen):
    """Location and Work mode of a linked Applications row, read once per page (the app's jobs list may not
    have it, e.g. an application made before Job Pilotto). {} when Notion can't give it."""
    if page_id not in seen:
        try:
            props = tracker._request('GET', f'pages/{page_id}')['properties']
            seen[page_id] = {'location': plain(props.get('Location')) or '', 'work_mode': plain(props.get('Work mode')) or ''}
        except Exception:  # noqa: BLE001 - a trashed or unshared page: the row still lists, without a place
            seen[page_id] = {}
    return seen[page_id]


def listing(tracker, limit=100):
    """🎤 Interviews rows for the app, newest first: reviewed when Overall is set. `place` is where the linked
    application's job is (Location, Work mode from Applications)."""
    rows = []
    for row in tracker.query_database(INTERVIEWS_DATABASE_ID):
        props = row['properties']
        rows.append({'id': row['id'], 'url': row.get('url', ''), 'title': plain(props.get('Interview')) or 'Interview',
                     'date': plain(props.get('Date')) or row.get('created_time', '')[:10],
                     'input': plain(props.get('Input')) or '', 'overall': plain(props.get('Overall')) or '',
                     'round': plain(props.get('Round')) or '', 'next_step': plain(props.get('Next step')) or '',
                     'application': [r['id'] for r in (props.get('Application') or {}).get('relation', [])]})
    rows.sort(key=lambda r: r['date'], reverse=True)
    rows, seen = rows[:limit], {}
    for row in rows:
        row['place'] = _place(tracker, row['application'][0], seen) if row['application'] else {}
    return rows


NO_NOTES = 'No notes written. The interview was held (confirmed in Focus).'


def held(tracker, app_id, notes='', *, now=None):
    """Focus → "Yes, it happened": a 🎤 Interviews row (Input Notes, dated the day of the interview) with the notes
    where a transcript goes, and the application moved on. review: the notes are long enough for a review (the
    app then runs it, on this Mac or on GitHub)."""
    now = now or datetime.now(timezone.utc)
    app = tracker._request('GET', f'pages/{app_id}')
    props = app['properties']
    coming = _moment(plain(props.get('Next interview')))
    day = (coming if coming and coming <= now else now).date().isoformat()
    who = plain(props.get('Company')) or plain(props.get('Via')) or 'Interview'
    notes = (notes or '').strip()[:MAX_CHARS]
    page = tracker._request('POST', 'pages', {'parent': {'database_id': INTERVIEWS_DATABASE_ID}, 'properties': {
        'Interview': {'title': [{'text': {'content': f"{who} · {titles.row_role(props) or 'interview'}"[:200]}}]},
        'Date': {'date': {'start': day}}, 'Input': {'select': {'name': 'Notes'}},
        'Application': {'relation': [{'id': app['id']}]}},
        'children': [job_line(app), _block('paragraph', PLACEHOLDER), transcript_toggle(notes or NO_NOTES)]})
    stage = advance(tracker, app, now=now, note='Held (confirmed in Focus)', source=APP_SOURCE)
    return {'ok': True, 'id': page['id'], 'url': page.get('url', ''), 'stage': stage, 'review': len(notes) >= 40}


def moved(tracker, app_id, at):
    """Focus → "No: moved": Next interview is the new time, and an Interview scheduled event says so."""
    moment = _moment(at)
    if not moment:
        raise ValueError('Pick the new date and time')
    app = tracker._request('GET', f'pages/{app_id}')
    tracker.update_page(app['id'], {'Next interview': {'date': {'start': at}}})
    add_event(tracker, app, 'Interview scheduled', APP_SOURCE, note=f'Moved to {at} (from Focus)', interview_at=at)
    return {'ok': True}


def cancelled(tracker, app_id):
    """Focus → "No: cancelled": an Interview cancelled event, Next interview cleared; the Stage stays."""
    app = tracker._request('GET', f'pages/{app_id}')
    add_event(tracker, app, CANCELLED, APP_SOURCE, note='The interview did not happen (from Focus)')
    tracker.update_page(app['id'], {'Next interview': {'date': None}})
    return {'ok': True}


def sweep(tracker, now=None):
    """Applications still at Recruiter lead / Screening / Interview scheduled whose Next interview has passed and
    which have a 🎤 Interviews row from that day on (recorded): moved on (advance), as a review would.
    For rows saved before save() did it. Returns a one-line summary."""
    now = now or datetime.now(timezone.utc)
    if not INTERVIEWS_DATABASE_ID:
        return 'Interview sweep: no 🎤 Interviews database'
    days = {}
    for row in tracker.query_database(INTERVIEWS_DATABASE_ID):
        day = (plain(row['properties'].get('Date')) or '')[:10]
        for link in (row['properties'].get('Application') or {}).get('relation', []):
            key = link['id'].replace('-', '')
            days[key] = max(days.get(key, ''), day)
    moved_on = 0
    for app in tracker.query_database(tracker.database_id, {'or': [
            {'property': 'Stage', 'select': {'equals': stage}} for stage in IN_TALKS]}):
        coming = _moment(plain(app['properties'].get('Next interview')))
        if coming and coming <= now and days.get(app['id'].replace('-', ''), '') >= coming.date().isoformat():
            advance(tracker, app, now=now, note='Recorded interview', source='Auto rule', clear_past=False)
            moved_on += 1
    return f'Interview sweep: {moved_on} application(s) moved on after a recorded interview.'


def main(argv=None):
    """JSON commands for the desktop app's Interviews page (Notion is the database; nothing here uses AI)."""
    import argparse
    parser = argparse.ArgumentParser(description=main.__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list')
    saving = sub.add_parser('save', help='a transcript file as a new row')
    saving.add_argument('file', type=Path)
    saving.add_argument('--title', default='')
    saving.add_argument('--job', help='job URL of the application it belongs to')
    saving.add_argument('--input', default='Recording', choices=('Recording', 'Transcript', 'Notes'))
    saving.add_argument('--page', help='update this row (created when the transcript was ready) instead of adding one')
    deleting = sub.add_parser('delete', help="move a row to Notion's trash")
    deleting.add_argument('page')
    linking = sub.add_parser('link', help="set a row's application (no --job: clear it)")
    linking.add_argument('page')
    linking.add_argument('--job')
    holding = sub.add_parser('held', help='Focus: the interview happened (notes optional)')
    holding.add_argument('app')
    holding.add_argument('--notes', default='')
    moving = sub.add_parser('moved', help='Focus: the interview moved to a new time')
    moving.add_argument('app')
    moving.add_argument('--at', required=True)
    cancelling = sub.add_parser('cancelled', help='Focus: the interview did not happen')
    cancelling.add_argument('app')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker or not INTERVIEWS_DATABASE_ID:
        print(json.dumps({'ok': False, 'error': 'Connect Notion first: interviews are kept in 🎤 Interviews.'}))
        return 1
    try:
        if args.command == 'list':
            problems = []
            out = {'ok': True, 'interviews': listing(tracker), 'insight': saved_insight(tracker, problems)}
            if problems:
                out['insight_error'] = problems[0]  # the app logs it and says so on the card; the list still shows
        elif args.command == 'save':
            page = save(tracker, args.file.read_text(encoding='utf-8'), args.title, job_url=args.job, source=args.input,
                        page_id=args.page)
            out = {'ok': True, 'id': page['id'], 'url': page.get('url', '')}
        elif args.command == 'delete':
            delete(tracker, args.page)
            out = {'ok': True}
        elif args.command == 'held':
            out = held(tracker, args.app, args.notes)
        elif args.command == 'moved':
            out = moved(tracker, args.app, args.at)
        elif args.command == 'cancelled':
            out = cancelled(tracker, args.app)
        else:
            out = {'ok': True, 'application': link(tracker, args.page, args.job)}
    except ValueError as error:
        out = {'ok': False, 'error': str(error)}
    print(json.dumps(out))
    return 0 if out['ok'] else 1


def saved_insight(tracker, problems=None):
    """The Interviews page's insight (💡 Insights, Interview patterns), or None; a failed read never fails the list.
    problems: gets the reason (error type and message, no values), for the app's log and the card."""
    from . import interview_insights
    try:
        return interview_insights.saved(tracker)
    except Exception as error:  # noqa: BLE001
        reason = f'{type(error).__name__}: {error}'
        print(f'Warning: interview insights unreadable: {reason}', file=sys.stderr)
        if problems is not None:
            problems.append(reason)
        return None


def stats_for_insights(tracker):
    """Interview topics across all interviews, for the daily insight and weekly report."""
    rows = [{name: plain(prop) for name, prop in r['properties'].items()}
            for r in tracker.query_database(INTERVIEWS_DATABASE_ID)]
    rows = [r for r in rows if r.get('Overall')]  # saved transcripts not reviewed yet have no analysis
    split = lambda value: [t.strip() for t in (value or '').split(';') if t.strip()]
    topics, weak = {}, {}
    for row in rows:
        for t in split(row.get('Topics')):
            topics[t] = topics.get(t, 0) + 1
        for t in split(row.get('Weak topics')):
            weak[t] = weak.get(t, 0) + 1
    top = lambda d: dict(sorted(d.items(), key=lambda kv: -kv[1])[:15])
    return {'interviews': len(rows), 'overall': {k: sum(r.get('Overall') == k for r in rows)
                                                for k in ('positive', 'neutral', 'negative')},
            'topics_asked': top(topics), 'topics_answered_weakly': top(weak),
            'rounds': [f"{r.get('Date')} · {r.get('Interview')} · {r.get('Overall')}" for r in rows][-10:]}


if __name__ == '__main__':
    raise SystemExit(main())
