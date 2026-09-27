#!/usr/bin/env python3
"""Interview analysis: a transcript file or typed notes sent to the Telegram bot -> 🎤 Interviews.

The Worker passes the Telegram file id (or the notes text) to a `--mode interview` run. This module
downloads the file, strips subtitle timing (.srt/.vtt), and asks Claude Sonnet 5 in one call to
(1) pick which application the interview belongs to, from the caption and the transcript, and
(2) pull out the questions by topic, how each was answered, strengths, weak spots, signals from the
interviewers, the next step and what to practise.

The result is a 🎤 Interviews row linked to the application (analysis plus the full transcript in its
page body), an Interviewing event in 📈 Application Events, the Stage moved forward to Interviewing
(never back), and a Telegram summary. The daily insight and weekly report read the Interviews rows.
Each user's Notion is their own private database; the transcript stays there and in Telegram.
"""
from datetime import datetime, timezone
from html import escape
import json
import os
import re
from pathlib import Path
import urllib.request

from ..notion import client as notion
from ..notion.ledger import EVENTS_DATABASE_ID, add_event, plain
from . import cost

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_INTERVIEW_MODEL', 'claude-sonnet-5')
INTERVIEWS_DATABASE_ID = os.getenv('NOTION_INTERVIEWS_DB', '')
TEXT_TYPES = ('.txt', '.md', '.srt', '.vtt', '.text')
MAX_CHARS = 180_000  # about 3 hours of speech, within Notion's request size; longer files are cut, with a note
# Stages an interview can move an application forward from; later stages are never overwritten.
BEFORE_INTERVIEW = ('Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Applying', 'No response')
CANDIDATE_STAGES = BEFORE_INTERVIEW + ('Interviewing', 'Offer', 'Rejected')

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['application', 'company', 'round', 'interviewers', 'duration_min', 'questions', 'strengths',
                 'weaknesses', 'signals', 'red_flags', 'next_step', 'practice', 'overall', 'summary'],
    'properties': {
        'application': {'type': 'integer', 'description': 'Index of the matching application in the list, or -1 if unclear'},
        'company': {'type': 'string', 'description': 'Company as named in the caption or transcript'},
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
    },
}

SYSTEM = """You review job interviews for the candidate (the owner of Job Pilotto). You get the candidate's \
profile, the list of their applications, the caption they wrote, and a transcript or their own notes.

- Identify the application from the caption first, then the transcript (company, role). If two \
applications at the same company fit, prefer the one in an interview stage or applied most recently. \
Use -1 when you can't tell.
- The transcript may not label speakers. Infer who is the candidate from context (the profile helps).
- Be honest and specific. "weak" means the answer missed what the question was probing, was vague, or \
was wrong; say what a stronger answer would add, using the candidate's real experience from the profile.
- Only report what the transcript supports. Notes written by the candidate are their own recollection; \
say less when the input is thin.
- Interviewers by role only; never names.

The candidate's profile follows.

"""


def download(token, file_id, opener=urllib.request.urlopen):
    """(file name, text) of a Telegram document, via getFile."""
    with opener(f'https://api.telegram.org/bot{token}/getFile?file_id={file_id}', timeout=20) as response:
        info = json.load(response)
    if not info.get('ok'):
        raise RuntimeError(info.get('description', 'Telegram getFile failed'))
    path = info['result']['file_path']
    with opener(f'https://api.telegram.org/file/bot{token}/{path}', timeout=60) as response:
        raw = response.read()
    return path.rsplit('/', 1)[-1], raw.decode('utf-8', errors='replace')


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


def analyse(client, model, profile, apps, caption, transcript):
    listing = '\n'.join(
        f"{i}. {plain(r['properties'].get('Company'))} — {plain(r['properties'].get('Job'))} "
        f"(stage {plain(r['properties'].get('Stage'))}, applied {plain(r['properties'].get('Applied on')) or '?'})"
        for i, r in enumerate(apps))
    response = client.messages.create(
        model=model, max_tokens=8000,
        system=[{'type': 'text', 'text': SYSTEM + profile}],
        messages=[{'role': 'user', 'content': f'Applications:\n{listing or "(none)"}\n\nCaption: {caption or "(none)"}\n\n'
                                              f'Transcript or notes:\n{transcript}'}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}, 'effort': 'medium'},
    )
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    return json.loads(next(block.text for block in response.content if block.type == 'text')), response.usage


def _block(kind, content, bold=False):
    chunks = [content[i:i + 1900] for i in range(0, len(content), 1900)] or ['']
    return {'object': 'block', 'type': kind, kind: {'rich_text': [
        {'type': 'text', 'text': {'content': c}, 'annotations': {'bold': bold}} for c in chunks[:100]]}}


def page_blocks(result, transcript):
    """Analysis first, then the full transcript in a toggle. At most ~95 blocks per request."""
    marks = {'strong': '✅', 'ok': '➖', 'weak': '⚠️', 'not_answered': '❌'}
    blocks = [_block('paragraph', result['summary'])]
    for title, items in (('Strengths', result['strengths']), ('Weak spots', result['weaknesses']),
                         ('Signals from them', result['signals']), ('Could count against you', result['red_flags']),
                         ('Practise before the next round', result['practice'])):
        if items:
            blocks += [_block('heading_3', title)] + [_block('bulleted_list_item', item) for item in items[:6]]
    blocks.append(_block('heading_3', 'Questions'))
    for q in result['questions'][:20]:
        text = f"{marks.get(q['quality'], '')} [{q['topic']}] {q['question']} — {q['answer']}"
        blocks.append(_block('bulleted_list_item', text + (f" → Better: {q['better']}" if q['better'] else '')))
    toggle = _block('heading_3', 'Transcript')
    paragraphs = [transcript[i:i + 190_000] for i in range(0, len(transcript), 190_000)] or ['']
    toggle['heading_3'].update(is_toggleable=True, children=[_block('paragraph', p) for p in paragraphs])
    return blocks[:94] + [toggle]


def properties(result, app, today, model, usd, is_file):
    text = lambda value: {'rich_text': [{'text': {'content': value[:2000]}}]}
    topics = list(dict.fromkeys(q['topic'] for q in result['questions']))
    weak = list(dict.fromkeys(q['topic'] for q in result['questions'] if q['quality'] in ('weak', 'not_answered')))
    props = {
        'Interview': {'title': [{'text': {'content': f"{result['company'] or 'Interview'} · {result['round']}"[:200]}}]},
        'Date': {'date': {'start': today.isoformat()}},
        'Round': text(result['round']),
        'Overall': {'select': {'name': result['overall']}},
        'Questions': {'number': len(result['questions'])},
        'Weak answers': {'number': sum(q['quality'] in ('weak', 'not_answered') for q in result['questions'])},
        'Topics': text('; '.join(topics)),
        'Weak topics': text('; '.join(weak)),
        'Next step': text(result['next_step']),
        'Input': {'select': {'name': 'Transcript' if is_file else 'Notes'}},
        'Cost (USD)': {'number': round(usd, 4)},
        'Model': text(model),
    }
    if app:
        props['Application'] = {'relation': [{'id': app['id']}]}
    return props


def message(result, app, page_url, usd, truncated=False):
    title = (f"{escape(plain(app['properties'].get('Company')) or '')} — {escape(plain(app['properties'].get('Job')) or '')}"
             if app else f"{escape(result['company'] or 'Unknown company')} (not linked to an application)")
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
    if truncated:
        lines.append('<i>The transcript was very long; only the first part was analysed.</i>')
    if not app:
        lines.append('<i>Link it to its application in Notion (Application column).</i>')
    lines.append(f'<a href="{escape(page_url, quote=True)}">Full analysis and transcript</a> · ${usd:.3f}')
    return '\n'.join(lines)


SCREEN = re.compile(r'screen|recruiter|talent|phone|intro', re.I)
FUNNEL = ('Applying', 'Applied', 'No response', 'Confirmation received', 'Screening', 'Interview scheduled',
          'Interviewing', 'Offer')


def progress(tracker, app, result):
    """Stage and event for a reviewed interview. A recruiter/screening round is Screening, anything later is
    Interviewing. Stage only moves forward, and the event is skipped when one of that kind already exists
    (a review is often sent days after the call, which was usually logged already)."""
    kind = 'Screening' if SCREEN.search(result.get('round') or '') else 'Interviewing'
    page = app['id'].replace('-', '')
    logged = any(plain(e['properties'].get('Kind')) == kind
                 for e in tracker.query_database(EVENTS_DATABASE_ID)
                 if any(l['id'].replace('-', '') == page for l in (e['properties'].get('Application') or {}).get('relation', [])))
    if not logged:
        add_event(tracker, app, kind, 'Telegram', note=f"{result['round']}: {result['overall']}")
    stage = plain(app['properties'].get('Stage'))
    if stage in FUNNEL and FUNNEL.index(kind) > FUNNEL.index(stage):
        tracker.update_page(app['id'], {'Stage': {'select': {'name': kind}}})


def run(tracker, *, file_id=None, note='', token=None, send=None, model=DEFAULT_MODEL, client=None,
        now=None, opener=urllib.request.urlopen, stats=None):
    """Analyse one interview (a Telegram file, or notes text) and record it. Returns a log line."""
    now = now or datetime.now(timezone.utc)
    caption, transcript, name = note, '', ''
    if file_id and Path(file_id).is_file():
        # The desktop app passes a transcript file from the Mac instead of a Telegram file id.
        name, transcript = Path(file_id).name, Path(file_id).read_text(encoding='utf-8', errors='replace')
        if not name.lower().endswith(TEXT_TYPES):
            raise ValueError(f'{name}: choose a text transcript ({", ".join(TEXT_TYPES)})')
        transcript = clean(transcript)
    elif file_id:
        name, transcript = download(token, file_id, opener)
        if not name.lower().endswith(TEXT_TYPES):
            raise ValueError(f'{name}: send a text transcript ({", ".join(TEXT_TYPES)})')
        transcript = clean(transcript)
    else:
        # "/interview <caption line>\n<notes>" — the first line names the interview, the rest is notes.
        body = re.sub(r'^/interview(@\w+)?\s*', '', note or '')
        caption, _, transcript = body.partition('\n')
        transcript = transcript.strip() or caption
    if len(transcript.strip()) < 40:
        raise ValueError('Too little text to analyse. Send the transcript file, or /interview <company, round> '
                         'with your notes on the next lines.')
    truncated = len(transcript) > MAX_CHARS
    transcript = transcript[:MAX_CHARS]
    apps = candidates(tracker)
    if client is None:
        import anthropic
        client = anthropic.Anthropic()
    result, usage = analyse(client, model, tracker.page_text(), apps, caption, transcript)
    cost.add(stats, model, usage)
    usd = cost.usd(model, usage)
    app = apps[result['application']] if 0 <= result['application'] < len(apps) else None
    page = tracker._request('POST', 'pages', {
        'parent': {'database_id': INTERVIEWS_DATABASE_ID},
        'properties': properties(result, app, now.date(), model, usd, bool(file_id)),
        'children': page_blocks(result, transcript)})
    if app:
        progress(tracker, app, result)
    if send:
        send(message(result, app, page.get('url', ''), usd, truncated))
    where = f"{plain(app['properties'].get('Company'))}" if app else 'unlinked'
    return f"Interview analysed ({where}, {result['round']}, {len(result['questions'])} questions, ${usd:.3f})"


def stats_for_insights(tracker):
    """Interview topics across all interviews, for the daily insight and weekly report."""
    rows = [{name: plain(prop) for name, prop in r['properties'].items()}
            for r in tracker.query_database(INTERVIEWS_DATABASE_ID)]
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
