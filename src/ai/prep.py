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
    'required': ['interview_type', 'since_last_call', 'do_differently', 'assess', 'questions', 'stories', 'gaps', 'ask_them', 'plan', 'unknowns'],
    'properties': {
        'interview_type': {'type': 'string', 'description': 'recruiter screen, recruiter follow-up, hiring manager, technical, '
                                                            'system design, or other'},
        'since_last_call': {'type': 'array', 'items': {'type': 'string'},
                            'description': 'Follow-up only (else []): what the earlier calls established, and what they said '
                                           'would be discussed next (e.g. salary, contract setup, relocation), 3-6 items'},
        'do_differently': {'type': 'array', 'items': {'type': 'string'},
                           'description': 'Follow-up only (else []): what to do differently this round, from how the last call went'},
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
When "What already happened on THIS application" lists earlier interviews, this is a FOLLOW-UP round: don't repeat an
intro kit (the pitch, generic motivation questions they already heard). Fill since_last_call with what the last call
established and what they said would be discussed next; questions are the likely ones for THIS round (e.g. salary,
contract setup, relocation, start date for a recruiter follow-up; deeper stack and incidents for a technical round);
do_differently from the weak answers and how the last call went; ask_them only what is still open. The recruiter's
latest message says what this call is for. Without earlier interviews, since_last_call and do_differently are [].
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
    blocks = ledger.md_blocks(body)  # headings, lists and bold, not raw Markdown
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


MAX_EARLIER = 3  # earlier interviews of this application the kit reads (newest first)
REVIEW_PARTS = {'Weak spots': 3, 'Signals from them': 5, 'Could count against you': 3, 'Facts from the call': 6,
                'Practise before the next round': 3}


def _text_of(block):
    return plain({'type': 'rich_text', 'rich_text': block.get(block['type'], {}).get('rich_text', [])}) or ''


def review_of(tracker, page_id):
    """The review saved on a 🎤 Interviews page (src/ai/interviews.py analysis_blocks), read back as
    {'summary', 'weak_answers': [question lines marked ⚠️/❌], <section title>: [lines]}; the transcript is not read."""
    from . import interviews
    review, section = {'summary': '', 'weak_answers': []}, None
    for block in tracker._children(page_id):
        kind, text = block['type'], _text_of(block)
        if kind.startswith('heading_'):
            if text == 'Transcript':
                break
            section = text
            continue
        if not text or text == interviews.PLACEHOLDER or text.startswith('🔗'):
            continue
        if section is None and kind == 'paragraph' and not review['summary']:
            review['summary'] = text
        elif section == 'Questions' and text[:1] in ('⚠', '❌'):
            review['weak_answers'].append(text)
        elif section in REVIEW_PARTS:
            review.setdefault(section, []).append(text)
    return review


def earlier_interviews(tracker, row):
    """What already happened on THIS application: its reviewed 🎤 Interviews rows (newest first, at most MAX_EARLIER)
    with each review's summary, next step, weak answers, what they said, and facts from the call. [] when none."""
    from . import interviews
    from .. import focus
    if not interviews.INTERVIEWS_DATABASE_ID:
        return []
    try:
        rows = tracker.query_database(interviews.INTERVIEWS_DATABASE_ID, {'property': 'Application', 'relation': {'contains': row['id']}})
    except Exception as error:  # noqa: BLE001 — the kit is still useful without them
        print(f'Warning: interviews of this job unreadable: {type(error).__name__}: {error}', file=sys.stderr)
        return []
    found = focus.reviewed_interviews(rows, row['id'])[:MAX_EARLIER]
    for one in found:
        try:
            one['review'] = review_of(tracker, one['id'])
        except Exception as error:  # noqa: BLE001 — the row's own columns are still worth giving
            print(f'Warning: interview review unreadable: {type(error).__name__}: {error}', file=sys.stderr)
            one['review'] = {}
    return found


def latest_events(tracker, row, limit=3):
    """The application's latest 📈 Application Events with a note (newest first): e.g. the recruiter asking to confirm
    a follow-up time. Lines for the prompt."""
    if not ledger.EVENTS_DATABASE_ID:
        return []
    try:
        events = tracker.query_database(ledger.EVENTS_DATABASE_ID, {'property': 'Application', 'relation': {'contains': row['id']}})
    except Exception as error:  # noqa: BLE001
        print(f'Warning: events of this job unreadable: {type(error).__name__}: {error}', file=sys.stderr)
        return []
    at = lambda e: plain(e['properties'].get('At')) or ''
    events = [e for e in sorted(events, key=at, reverse=True) if plain(e['properties'].get('Note'))]
    return [f"- {at(e)[:16].replace('T', ' ')} · {plain(e['properties'].get('Kind')) or 'Event'}: "
            f"{plain(e['properties'].get('Note'))[:400]}" for e in events[:limit]]


def follow_up_text(earlier, events):
    """The prompt's "What already happened on THIS application" section, or '' with no earlier interview."""
    if not earlier:
        return ''
    parts = ['# What already happened on THIS application (a follow-up round)']
    for one in earlier:
        review = one.get('review') or {}
        lines = [f"## {one['day']} · {one['round'] or 'Interview'} · went {one['overall'] or '—'}"]
        if review.get('summary'):
            lines.append(f"Summary: {review['summary'][:600]}")
        lines.append(f"Next step they said: {one['next_step'] or 'not stated'}")
        if one['weak_topics']:
            lines.append(f"Topics answered weakly: {one['weak_topics']}")
        for answer in review.get('weak_answers', [])[:4]:
            lines.append(f'- {answer[:300]}')
        for title, most in REVIEW_PARTS.items():
            if review.get(title):
                lines.append(f'{title}:\n' + '\n'.join(f'- {x[:300]}' for x in review[title][:most]))
        parts.append('\n'.join(lines)[:3000])
    if events:
        parts.append("## The recruiter's latest messages on this job (newest first)\n" + '\n'.join(events))
    return '\n\n'.join(parts)


READ_MODEL = os.getenv('JOB_PILOTTO_INBOX_MODEL', 'claude-haiku-4-5')
MAX_SHOTS = 5


def _ask():
    return {'ok': False, 'needs_description': True,
            'text': 'To prepare you, Job Pilotto needs the job description: paste it, or the posting link.'}


def screenshots(tracker, row, fetch=True, opener=None):
    """The images on the job's page (logged screenshots, also inside folded log entries), newest last, as
    (name, bytes, media type); with fetch=False only their URLs."""
    import urllib.request
    found = []

    def walk(blocks, depth=0):
        for block in blocks:
            if block.get('type') == 'image':
                image = block['image']
                url = (image.get('file') or {}).get('url') or (image.get('external') or {}).get('url')
                if url:
                    found.append(url)
            elif block.get('has_children') and depth < 3:  # inside a folded log entry and its columns
                walk(tracker._children(block['id']), depth + 1)
    walk(tracker._children(row['id']))
    found = found[-MAX_SHOTS:]
    if not fetch:
        return found
    shots = []
    for number, url in enumerate(found, 1):
        try:
            with (opener or urllib.request.urlopen)(url, timeout=30) as response:
                data, kind = response.read(), (response.headers.get('Content-Type') or 'image/png').split(';')[0]
            shots.append((f'shot-{number}', data, kind if kind.startswith('image/') else 'image/png'))
        except Exception as error:  # noqa: BLE001 — one unreadable picture doesn't stop the others
            print(f'Warning: screenshot {number} not read: {type(error).__name__}: {error}', file=sys.stderr)
    return shots


def role_from_screenshots(tracker, row, client, stats=None):
    """What the job's screenshots say about the role, transcribed (Claude reads them together), else ''."""
    shots = screenshots(tracker, row)
    if not shots:
        return ''
    print(f'⏳ Reading the {len(shots)} screenshots on the job for its description', file=sys.stderr, flush=True)
    import base64
    content = [{'type': 'image', 'source': {'type': 'base64', 'media_type': kind, 'data': base64.b64encode(data).decode()}}
               for _, data, kind in shots]
    content.append({'type': 'text', 'text': 'These screenshots are about one job (e.g. a chat with a recruiter). Transcribe '
                    'everything they say about the role itself: company or client, responsibilities, stack, team, '
                    'requirements, location, work mode, contract, pay, interview process. Plain text, no commentary; '
                    'nothing if they say nothing about the role.'})
    response = client.messages.create(model=READ_MODEL, max_tokens=2000, messages=[{'role': 'user', 'content': content}])
    cost.add(stats, READ_MODEL, response.usage)
    return next((b.text for b in response.content if b.type == 'text'), '').strip()


def build(tracker, row, client=None, model=DEFAULT_MODEL, stats=None, now=None, db_path=None):
    from . import interviews
    now = now or datetime.now(timezone.utc)
    role = role_text(tracker, row, db_path)
    if client is None and about_role(role) < MIN_ROLE and not screenshots(tracker, row, fetch=False):
        return _ask()
    if client is None:
        from . import engine
        client = engine.client(action='prep')
    if about_role(role) < MIN_ROLE:
        # Screenshots you logged on the job (e.g. a LinkedIn chat, before the Log box kept its text) say what the
        # role is: read them, keep that as the job's description, and go on instead of asking you again.
        read = role_from_screenshots(tracker, row, client, stats)
        if about_role(read) >= MIN_ROLE // 2:
            describe(tracker, row, text=read)
            role = f'{read}\n\n{role}'.strip()
    if about_role(role) < MIN_ROLE // 2:
        return _ask()
    profile = tracker.page_text()
    history = what_you_learned(tracker, row)
    earlier = earlier_interviews(tracker, row)
    follow_up = follow_up_text(earlier, latest_events(tracker, row) if earlier else [])
    coming = mail._when(mail._field(row, 'Next interview'))
    facts = [f"Role: {mail._role(row)}", f"Employer: {mail._field(row, 'Company') or 'not named'}",
             f"Via: {mail._field(row, 'Via') or '—'} (contact: {mail._field(row, 'Contact') or '—'})",
             f"Stage: {mail._field(row, 'Stage')}", f"Salary: {mail._field(row, 'Salary') or 'unknown'}",
             f"Interview: {coming.astimezone(mail.TZ):%a %d %b %H:%M} ({round((coming - now).total_seconds() / 3600)} h from now)"
             if coming else 'Interview: time unknown',
             ] + history
    response = client.messages.create(
        # Room for the model's thinking plus a full kit (3000 cut one off mid-answer); medium effort, as the kits.
        model=model, max_tokens=8000, system=SYSTEM,
        messages=[{'role': 'user', 'content': '\n'.join(facts) + (f'\n\n{follow_up}' if follow_up else '')
                   + f'\n\n# The job\n{role[:12000]}\n\n# Owner\'s Profile\n{profile[:12000]}'}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}, 'effort': 'medium'})
    cost.add(stats, model, response.usage)
    if getattr(response, 'stop_reason', None) == 'max_tokens':  # a cut-off answer is no kit: say so, not a JSON error
        raise RuntimeError('The prep kit came back cut off (too long for one answer). Try again; if it repeats, the job text is very long.')
    kit = json.loads(next(b.text for b in response.content if b.type == 'text'))
    usd = cost.usd(model, response.usage)
    write_kit(tracker, row['id'], blocks(kit, now, usd), earlier_day=mail._field(row, 'Interview prep'))
    try:  # with the time: Focus compares it with the interviews reviewed since (src/focus.py prep_state)
        tracker.update_page(row['id'], {'Interview prep': {'date': {'start': now.isoformat(timespec='seconds')}}})
    except Exception as error:  # noqa: BLE001 — a workspace without the column yet (the app adds it)
        print(f'Warning: Interview prep date not set: {type(error).__name__}: {error}', file=sys.stderr)
    after = f", after {len(earlier)} earlier interview{'s' if len(earlier) != 1 else ''}" if earlier else ''
    return {'ok': True, 'text': f"Prep kit ready on the job's page ({kit['interview_type']}{after}, ${usd:.2f}).", 'usd': usd}


KIT_TITLES = ('Since your last call', 'Do differently this time', 'What they will likely assess', 'Likely questions',
              'Stories to have ready', 'Gaps and how to handle them', 'Ask them', 'Still unknown: ask the recruiter',
              'Your prep plan')
EARLIER = 'Earlier kit'
MAX_BLOCKS = 95  # a kit, and the earlier kit inside its toggle: within Notion's 100 blocks per request


def blocks(kit, now, usd):
    bullet = lambda text: _block('bulleted_list_item', text)
    out = [_block('paragraph', f"{kit['interview_type'].capitalize()} · built {now:%d %b %Y} · ${usd:.2f}", bold=True)]
    if kit.get('since_last_call'):
        out += [_block('heading_3', 'Since your last call')] + [bullet(x) for x in kit['since_last_call']]
    if kit.get('do_differently'):
        out += [_block('heading_3', 'Do differently this time')] + [bullet(x) for x in kit['do_differently']]
    out += [_block('heading_3', 'What they will likely assess')] + [bullet(x) for x in kit['assess']]
    out += [_block('heading_3', 'Likely questions')] + [bullet(f"{q['question']} → {q['answer_with']}") for q in kit['questions']]
    out += [_block('heading_3', 'Stories to have ready')] + [bullet(x) for x in kit['stories']]
    if kit['gaps']:
        out += [_block('heading_3', 'Gaps and how to handle them')] + [bullet(x) for x in kit['gaps']]
    out += [_block('heading_3', 'Ask them')] + [bullet(x) for x in kit['ask_them']]
    if kit['unknowns']:
        out += [_block('heading_3', 'Still unknown: ask the recruiter')] + [bullet(x) for x in kit['unknowns']]
    out += [_block('heading_3', 'Your prep plan')] + [_block('numbered_list_item', x) for x in kit['plan']]
    return out[:MAX_BLOCKS]


COPYABLE = ('paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'to_do')


def _copy(block):
    """A block read from Notion, as one to write again (its text and styles; nothing nested)."""
    kind = block['type']
    rich = [{'type': 'text', 'text': {'content': r.get('plain_text', '')[:2000]},
             **({'annotations': r['annotations']} if r.get('annotations') else {})}
            for r in block.get(kind, {}).get('rich_text', [])]
    return {'object': 'block', 'type': kind, kind: {'rich_text': rich}}


def _section(children):
    """The prep section on a job page: (its heading, the blocks of the current kit, the blocks to drop: an older
    Earlier kit toggle). The section runs to the next heading that isn't one of the kit's own (heading_3 titles
    above) or to a database view. A page rebuilt before 30 Sep 2026 has old kit headings stacked below the newest kit:
    only the newest kit (up to its second "What they will likely assess") counts, the rest is dropped."""
    heading, kit, drop, older = None, [], [], False
    for child in children:
        kind = child['type']
        text = _text_of(child) if kind in COPYABLE or kind == 'toggle' else ''
        if heading is None:
            if kind.startswith('heading_') and text.startswith(HEADING):
                heading = child
            continue
        if kind in ('child_database', 'link_to_page') or (kind.startswith('heading_') and text not in KIT_TITLES):
            break
        if kind == 'toggle' and text.startswith(EARLIER):
            drop.append(child)
            continue
        if text == KIT_TITLES[2] and any(_text_of(b) == KIT_TITLES[2] for b in kit):
            older = True  # a second kit's headings: older than the newest one
        (drop if older else kit).append(child)
    return heading, kit, drop


def write_kit(tracker, page_id, kit_blocks, earlier_day=''):
    """The new kit under 🎤 Interview prep; the kit it replaces is kept below it in a folded toggle "Earlier kit · built
    <date>" (only the latest earlier one: an older Earlier kit toggle is dropped). Appends the section when the page has
    none."""
    children = tracker._children(page_id)
    heading, kit, drop = _section(children)
    if heading is None:
        tracker._request('PATCH', f'blocks/{page_id}/children', {'children': [_block('heading_2', HEADING)] + kit_blocks})
        return
    kept = [_copy(b) for b in kit if b['type'] in COPYABLE and _text_of(b)][:MAX_BLOCKS]
    for block in kit + drop:
        tracker._request('DELETE', f"blocks/{block['id']}")
    add = list(kit_blocks)
    if kept:
        first = _text_of(kit[0]) if kit else ''
        built = re.search(r'built (\d{1,2} \w{3} \d{4})', first)
        when = built.group(1) if built else (f'{int(earlier_day[8:10])} {datetime.fromisoformat(earlier_day[:10]):%b %Y}'
                                             if re.match(r'\d{4}-\d{2}-\d{2}', earlier_day or '') else 'earlier')
        toggle = _block('toggle', f'{EARLIER} · built {when}')
        toggle['toggle']['children'] = kept
        add.append(toggle)
    tracker._request('PATCH', f'blocks/{page_id}/children', {'children': add, 'after': heading['id']})


def logged_build(tracker, row, client=None, now=None):
    """build(), recorded as a run like every AI job (⏰ Cronjob Runs): its row opens as Running when it starts (Recent
    activity shows it while it works, tagged "By you") and is completed with its result, AI cost and duration, or as
    Failed with the error, so nothing only lives in the dialog. It counts toward the month's AI budget."""
    from ..notion import cron_runs
    run = cron_runs.new_run('prep')
    run['subject'] = cron_runs.job_subject(row)  # the row's title (at the end) names the job: "Company — Role"
    run['application'] = row['id']  # the run links to the job it was for
    run['headline'] = f"{mail._field(row, 'Company') or mail._field(row, 'Via')} · {mail._role(row)}"[:200]
    started = datetime.now(timezone.utc)
    cron_runs.begin(tracker, run)
    try:
        result = build(tracker, row, client=client, stats=run.setdefault('interview', {}), now=now)
    except Exception as error:  # noqa: BLE001 — recorded as failed, then shown in the dialog
        result = {'ok': False, 'text': f'{type(error).__name__}: {error}'[:300]}
    run['headline'] = f"{run['headline']}: {result.get('text', '')}"[:300]
    run['seconds'] = int((datetime.now(timezone.utc) - started).total_seconds())
    try:
        cron_runs.log_run(tracker, run, failed=not result.get('ok') and not result.get('needs_description'))
    except Exception as error:  # noqa: BLE001 — the kit matters more than its log line
        print(f'Warning: run not recorded: {type(error).__name__}: {error}', file=sys.stderr)
    return result


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
            result = logged_build(tracker, row)
    except Exception as error:  # noqa: BLE001 — the app shows the reason
        result = {'ok': False, 'text': f'{type(error).__name__}: {error}'[:300]}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('ok') or result.get('needs_description') else 1


if __name__ == '__main__':
    sys.exit(main())
