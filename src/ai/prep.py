#!/usr/bin/env python3
"""Interview prep kit: how to prepare for one interview, from the job's description, your Profile and how your past
interviews went. Written on the job's Notion page (🎤 Interview prep) and dated in the Interview prep column.

It needs to know the role first: the job's description (🧾 Job description, from a pasted message or screenshots, or
added here), a posting it can read, or a recruiter's message that describes the role. Without one it asks for it
(needs_description) instead of guessing.

    python -m src.ai.prep build <application page id>
    python -m src.ai.prep describe <application page id> [--text TEXT] [--url URL]
Prints one JSON line: {"ok": ..., "text": ..., "needs_description": ...}.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

from ..notion import client as notion, ledger
from ..notion.ledger import _block, plain
from . import cost, mail

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_PREP_MODEL', 'claude-sonnet-5')
HEADING = '🎤 Interview prep'
DESCRIPTION_HEADING = '🧾 Job description'
MIN_ROLE = 400  # characters about the role before a kit is worth building
SECTIONS = ('🧾 Job description', '🤝 Recruiter message', '📥 Logged')

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['interview_type', 'assess', 'questions', 'stories', 'gaps', 'ask_them', 'plan', 'unknowns'],
    'properties': {
        'interview_type': {'type': 'string', 'description': 'recruiter screen, hiring manager, technical, system design, or other'},
        'assess': {'type': 'array', 'items': {'type': 'string'}, 'description': '3-5 things this interview will likely assess'},
        'questions': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['question', 'answer_with'],
                      'properties': {'question': {'type': 'string'}, 'answer_with': {'type': 'string',
                                     'description': 'what from the owner\'s Profile to answer with (a concrete fact or story), 1-2 sentences'}}},
                      'description': '6-10 likely questions'},
        'stories': {'type': 'array', 'items': {'type': 'string'}, 'description': '3 stories from the Profile to have ready (situation, what you did, result)'},
        'gaps': {'type': 'array', 'items': {'type': 'string'}, 'description': 'where the role asks more than the Profile shows, and how to handle each honestly'},
        'ask_them': {'type': 'array', 'items': {'type': 'string'}, 'description': '4-6 good questions to ask them, incl. what the role leaves unclear'},
        'plan': {'type': 'array', 'items': {'type': 'string'}, 'description': 'a short prep plan, step by step, fitting the time left'},
        'unknowns': {'type': 'array', 'items': {'type': 'string'}, 'description': 'facts that matter but are unknown (employer, pay, …) to ask the recruiter'},
    },
}

SYSTEM = """You help the owner prepare for one job interview. Use only what the job text and the owner's Profile say;
never invent facts about the owner or the employer. For a recruiter or agency screen, focus on motivation, fit, the
owner's pitch, salary expectations, notice period and availability; for technical rounds, on depth in the role's stack,
incidents and trade-offs. What Job Pilotto learned about the owner (weak topics, topics asked most, rejection lessons, employer feedback):
work those into the questions, the gaps and the plan, and say where a past lesson applies.
Keep every item short and concrete."""


def _sections(text):
    """The job page's text by section heading (the page's own headings)."""
    parts, current = {}, ''
    for line in (text or '').splitlines():
        heading = re.match(r'^#+\s*(.+)$', line.strip())
        if heading:
            current = heading.group(1).strip()
            continue
        parts.setdefault(current, []).append(line)
    return {name: '\n'.join(lines).strip() for name, lines in parts.items()}


def role_text(tracker, row, db_path=None):
    """What's known about the role: the job's description, the posting in the job cache, the recruiter's message."""
    page = tracker.page_text(row['id'])
    sections = _sections(page)
    known = [sections.get(name, '') for name in SECTIONS if sections.get(name)]
    url = plain(row['properties'].get('Job URL'))
    if url and not re.search(r'mail\.google|linkedin\.com/messaging|jobpilotto', url):
        try:
            from .. import store
            from ..paths import JOBS_DB
            with store.connect(db_path or JOBS_DB) as db:
                hit = db.execute('SELECT description FROM jobs WHERE url=?', (url,)).fetchone()
            if hit and hit[0]:
                known.insert(0, hit[0])
        except Exception:  # noqa: BLE001 — the page is enough when the cache isn't there
            pass
    return '\n\n'.join(known).strip()


def about_role(text):
    """Characters that actually describe the role (a Teams invite or legal footer don't)."""
    noise = re.compile(r'teams\.microsoft|meeting id|passcode|dial in|confidential|registered|unsubscribe|https?://', re.I)
    return sum(len(line) for line in text.splitlines() if line.strip() and not noise.search(line))


def describe(tracker, row, text='', url=''):
    """You gave the role: pasted text, or a posting link (read, except LinkedIn and the like)."""
    body = (text or '').strip()
    if url and not body:
        meta = ledger.page_meta(url)
        body = (meta.get('description') or '').strip()
        if not body:
            return {'ok': False, 'text': "That page can't be read (LinkedIn and some sites never are): paste the description instead."}
    if len(body) < 80:
        return {'ok': False, 'text': 'Paste the whole job description (what the role does, its stack, requirements).'}
    blocks = [_block('paragraph', part[:1900]) for part in re.split(r'\n\s*\n', body)[:80] if part.strip()]
    if url:
        blocks.insert(0, _block('paragraph', f'Posting: {url}'))
    tracker.replace_after_heading(row['id'], DESCRIPTION_HEADING, blocks)
    return {'ok': True, 'text': 'Job description saved on the job.'}


def what_you_learned(tracker, row):
    """What Job Pilotto has learned about you so far, for this kit: topics you answered weakly and the ones asked
    most (reviewed interviews), why past applications were rejected (rejection reviews), and what employers said
    (employer feedback). Lines for the prompt; each part is left out when there's nothing yet."""
    from . import interviews
    stats = interviews.stats_for_insights(tracker)
    weak, asked = list(stats.get('topics_answered_weakly', {}))[:6], list(stats.get('topics_asked', {}))[:6]
    lines = [f"Topics you answered weakly in past interviews: {', '.join(weak) or 'none recorded yet'}"]
    if asked:
        lines.append(f"Topics interviewers asked most: {', '.join(asked)}")
    try:
        rows = tracker.query_database(tracker.database_id, {'or': [
            {'property': 'Rejection lesson', 'rich_text': {'is_not_empty': True}},
            {'property': 'Employer feedback', 'rich_text': {'is_not_empty': True}}]})
    except Exception:  # noqa: BLE001 — the kit is still useful without them
        rows = []
    rows = [r for r in rows if r['id'] != row['id']]
    rows.sort(key=lambda r: r.get('last_edited_time', ''), reverse=True)
    lessons = [f"{mail._field(r, 'Company') or mail._field(r, 'Via')}: {mail._field(r, 'Rejection lesson')[:240]}"
               for r in rows if mail._field(r, 'Rejection lesson')][:5]
    feedback = [f"{mail._field(r, 'Company') or mail._field(r, 'Via')}: {mail._field(r, 'Employer feedback')[:240]}"
                for r in rows if mail._field(r, 'Employer feedback')][:4]
    if lessons:
        lines.append('Lessons from your past rejections:\n- ' + '\n- '.join(lessons))
    if feedback:
        lines.append('What employers told you:\n- ' + '\n- '.join(feedback))
    return lines


def build(tracker, row, client=None, model=DEFAULT_MODEL, stats=None, now=None, db_path=None):
    from . import interviews
    now = now or datetime.now(timezone.utc)
    role = role_text(tracker, row, db_path)
    if about_role(role) < MIN_ROLE:
        return {'ok': False, 'needs_description': True,
                'text': 'To prepare you, Job Pilotto needs the job description: paste it, or the posting link.'}
    if client is None:
        import anthropic
        client = anthropic.Anthropic()
    profile = tracker.page_text()
    history = what_you_learned(tracker, row)
    coming = mail._when(mail._field(row, 'Next interview'))
    facts = [f"Role: {mail._field(row, 'Job')}", f"Employer: {mail._field(row, 'Company') or 'not named'}",
             f"Via: {mail._field(row, 'Via') or '—'} (contact: {mail._field(row, 'Contact') or '—'})",
             f"Stage: {mail._field(row, 'Stage')}", f"Salary: {mail._field(row, 'Salary') or 'unknown'}",
             f"Interview: {coming.astimezone(mail.TZ):%a %d %b %H:%M} ({round((coming - now).total_seconds() / 3600)} h from now)"
             if coming else 'Interview: time unknown',
             ] + history
    response = client.messages.create(
        model=model, max_tokens=3000, system=SYSTEM,
        messages=[{'role': 'user', 'content': '\n'.join(facts) + f'\n\n# The job\n{role[:12000]}\n\n# Owner\'s Profile\n{profile[:12000]}'}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}})
    cost.add(stats, model, response.usage)
    kit = json.loads(next(b.text for b in response.content if b.type == 'text'))
    usd = cost.usd(model, response.usage)
    tracker.replace_after_heading(row['id'], HEADING, blocks(kit, now, usd))
    try:
        tracker.update_page(row['id'], {'Interview prep': {'date': {'start': now.date().isoformat()}}})
    except Exception as error:  # noqa: BLE001 — a workspace without the column yet (the app adds it)
        print(f'Warning: Interview prep date not set: {type(error).__name__}: {error}', file=sys.stderr)
    return {'ok': True, 'text': f"Prep kit ready on the job's page ({kit['interview_type']}, ${usd:.2f}).", 'usd': usd}


def blocks(kit, now, usd):
    bullet = lambda text: _block('bulleted_list_item', text)
    out = [_block('paragraph', f"{kit['interview_type'].capitalize()} · built {now:%d %b %Y} · ${usd:.2f}", bold=True),
           _block('heading_3', 'What they will likely assess')] + [bullet(x) for x in kit['assess']]
    out += [_block('heading_3', 'Likely questions')] + [bullet(f"{q['question']} → {q['answer_with']}") for q in kit['questions']]
    out += [_block('heading_3', 'Stories to have ready')] + [bullet(x) for x in kit['stories']]
    if kit['gaps']:
        out += [_block('heading_3', 'Gaps and how to handle them')] + [bullet(x) for x in kit['gaps']]
    out += [_block('heading_3', 'Ask them')] + [bullet(x) for x in kit['ask_them']]
    if kit['unknowns']:
        out += [_block('heading_3', 'Still unknown: ask the recruiter')] + [bullet(x) for x in kit['unknowns']]
    out += [_block('heading_3', 'Your prep plan')] + [_block('numbered_list_item', x) for x in kit['plan']]
    return out[:95]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('build').add_argument('page_id')
    about = sub.add_parser('describe')
    about.add_argument('page_id')
    about.add_argument('--text', default='')
    about.add_argument('--url', default='')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if tracker is None:
        print(json.dumps({'ok': False, 'text': 'Notion is not connected.'}))
        return 1
    try:
        row = tracker._request('GET', f'pages/{args.page_id}')
        if args.command == 'describe':
            result = describe(tracker, row, args.text, args.url)
        else:
            print('⏳ Reading the job and your Profile', file=sys.stderr, flush=True)
            result = build(tracker, row)
    except Exception as error:  # noqa: BLE001 — the app shows the reason
        result = {'ok': False, 'text': f'{type(error).__name__}: {error}'[:300]}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('ok') or result.get('needs_description') else 1


if __name__ == '__main__':
    sys.exit(main())
