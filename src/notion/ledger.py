#!/usr/bin/env python3
"""The application ledger: what was sent for each application, and what happened afterwards.

Two parts, both in Notion (each user's own private workspace is their database):

- **Application record**, frozen on the job's Applications row when it's marked Applied: analysis
  columns (fit score, tier, seniority, work mode, ATS, agent, days from posting to applying, CV
  version, ...) plus a "🗂 Application record" toggle section in the page body with the job
  description, every question with the answer actually submitted (read from the form just before
  Submit when available, else the kit draft), the cover letter and a JSON block for analysis.
- **📈 Application Events**: one row per outcome change (Applied, Screening, Rejected, ...) with a
  time and how it was recorded. Stage on Applications only holds the latest; this is the history.

`sync` runs with the scheduled crawl: a Stage edited by hand in Notion becomes an event, and an
application with no reply after NO_RESPONSE_DAYS is moved to "No response".

Usage:
  python -m src.notion.ledger record <job URL> [--agent claude] [--force]
  python -m src.notion.ledger event <job URL> <stage> [--note TEXT]
  python -m src.notion.ledger sync [--dry-run]
  python -m src.notion.ledger backfill        # record every application tracked before the ledger
  python -m src.notion.ledger add <job URL> [--applied "on or before 23 Sep"] [--channel ...] [--via ...]
"""
import argparse
import hashlib
import json
import re
import os
import html
import json as _json
import re
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

from . import client as notion
from ..ai import kit as kit_module
from ..sources import ats

EVENTS_DATABASE_ID = os.getenv('NOTION_EVENTS_DB', '')
RECORD_HEADING = '🗂 Application record'
RECORD_VERSION = 1
NO_RESPONSE_DAYS = 30
APP_SUPPORT = Path.home() / 'Library' / 'Application Support' / 'JobPilotto'
SNAPSHOT_DIR = Path(os.getenv('JOB_PILOTTO_FORM_SNAPSHOT_DIR', str(APP_SUPPORT / 'form-snapshots')))
RUN_DIR = Path(os.getenv('JOB_PILOTTO_APPLY_RUN_DIR', str(APP_SUPPORT / 'apply-runs')))
DEFAULT_CV = os.getenv('JOB_PILOTTO_CV_PATH',
                       str(Path.home() / 'Documents' / 'CV.pdf'))
# Stages that are real application outcomes, in funnel order; each one is also an event Kind.
OUTCOME_STAGES = ('Applied', 'Confirmation received', 'Screening', 'Interview scheduled',
                  'Interviewing', 'Offer', 'Rejected', 'Withdrawn', 'No response')
# An event without a Stage of its own: a human replied (invitation to book a call, a recruiter's email).
REPLY = 'Reply received'
EVENT_KINDS = OUTCOME_STAGES + (REPLY,)
# Still waiting for a human reply: the no-response rule applies only to these.
WAITING_STAGES = ('Applied', 'Confirmation received')
CHANNELS = ('Direct', 'Recruiter platform', 'Agency', 'Referral')
# Job sites where a recruiter platform, not the employer, runs the process (Company = real employer, Via = platform).
RECRUITER_PLATFORMS = {'techtree.dev': 'TechTree'}
ATS_NAMES = {'greenhouse': 'Greenhouse', 'ashby': 'Ashby', 'lever': 'Lever', 'workable': 'Workable'}
AGENTS = {'claude': 'Claude', 'codex': 'Codex', 'chatgpt': 'ChatGPT', 'manual': 'Manual'}
SELECTS = {'Seniority': {'Junior', 'Mid', 'Senior', 'Staff/Principal', 'Lead/Manager'},
           'Work mode': {'On-site', 'Hybrid', 'Remote'}, 'Tier': {'A', 'B', 'C'}}


def plain(prop):
    """A Notion property value as a plain Python value."""
    if not prop:
        return None
    kind = prop.get('type') or next((k for k in ('title', 'rich_text', 'select', 'multi_select', 'number',
                                                 'checkbox', 'url', 'date') if k in prop), None)
    value = prop.get(kind)
    if kind in ('title', 'rich_text'):
        return ''.join(t.get('plain_text', '') for t in value or [])
    if kind == 'select':
        return (value or {}).get('name')
    if kind == 'multi_select':
        return [item['name'] for item in value or []]
    if kind == 'date':
        return (value or {}).get('start')
    return value


def _text(value):
    return {'rich_text': [{'text': {'content': str(value)[:2000]}}] if value else []}


def _chunks(content, size=1900):
    return [content[i:i + size] for i in range(0, len(content), size)] or ['']


def _block(kind, content, bold=False):
    return {'object': 'block', 'type': kind,
            kind: {'rich_text': [{'type': 'text', 'text': {'content': c}, 'annotations': {'bold': bold}}
                                 for c in _chunks(content)[:100]]}}


def _rich(text):
    """Inline Markdown (**bold**, *italic*, `code`) as Notion rich text."""
    parts, runs = re.split(r'(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)', text or ''), []
    for part in parts:
        if not part:
            continue
        bold, italic, code = part.startswith('**'), part.startswith('*') and not part.startswith('**'), part.startswith('`')
        content = part.strip('*`') if (bold or italic or code) else part
        for chunk in _chunks(content):
            runs.append({'type': 'text', 'text': {'content': chunk}, 'annotations': {'bold': bold, 'italic': italic, 'code': code}})
    return runs[:100] or [{'type': 'text', 'text': {'content': ''}}]


def _typed(kind, text):
    return {'object': 'block', 'type': kind, kind: {'rich_text': _rich(text)}}


def md_blocks(text, limit=90):
    """Markdown as Notion blocks: headings, bulleted and numbered lists, bold/italic inline, paragraphs. AI answers
    come as Markdown; written as plain paragraphs they showed "# Role Details" and "**Position:**" on the page."""
    blocks, paragraph = [], []

    def flush():
        if paragraph:
            blocks.append(_typed('paragraph', ' '.join(paragraph)))
            paragraph.clear()
    for line in (text or '').splitlines():
        stripped = line.strip()
        heading = re.match(r'^(#{1,6})\s+(.*)$', stripped)
        bullet = re.match(r'^[-*•]\s+(.*)$', stripped)
        number = re.match(r'^\d+[.)]\s+(.*)$', stripped)
        if not stripped or re.fullmatch(r'[-*_]{3,}', stripped):
            flush()
        elif heading:
            flush()
            blocks.append(_typed('heading_3', heading.group(2).strip('*')))
        elif bullet or number:
            flush()
            kind = 'bulleted_list_item' if bullet else 'numbered_list_item'
            blocks.append(_typed(kind, (bullet or number).group(1)))
        elif label := re.fullmatch(r'\*\*([^*]+?):?\*\*:?', stripped):  # "**Tech Stack:**" alone: the list below's heading
            flush()
            blocks.append(_typed('heading_3', label.group(1)))
        elif re.match(r'^\*\*[^*]+:\*\*|^\*\*[^*]+\*\*:', stripped):  # "**Position:** Principal SRE": a fact, one bullet each
            flush()
            blocks.append(_typed('bulleted_list_item', stripped))
        else:
            paragraph.append(stripped)
            flush()  # one line, one paragraph: AI answers break lines on purpose
    flush()
    return blocks[:limit]


def _key(text):
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()


def _day(value):
    try:
        return date.fromisoformat((value or '')[:10])
    except ValueError:
        return None


def form_snapshot(url, directory=None):
    """Field values read from the application page just before Submit by
    tools/wait-and-mark-applied.sh, or None when that capture wasn't available."""
    path = Path(directory or SNAPSHOT_DIR) / f'{notion.job_code(url)}.json'
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return data if data.get('fields') else None


def run_state(url, directory=None):
    """The local form-filling run record (agent, minutes), if a launcher recorded one."""
    try:
        return json.loads((Path(directory or RUN_DIR) / f'{notion.job_code(url)}.json').read_text())
    except (OSError, json.JSONDecodeError):
        return None


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


def match_for(tracker, url):
    """The job's Job Matches row (AI stage 1 facts and stage 2 scores) as plain values, or {}."""
    rows = tracker.query_database(notion.MATCHES_DATABASE_ID, {'property': 'Job URL', 'url': {'equals': url}})
    return {name: plain(prop) for name, prop in rows[0]['properties'].items()} if rows else {}


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


def record(tracker, url, *, now=None, force=False, posting=ats.posting, cv_path=DEFAULT_CV,
           snapshot_dir=None, run_dir=None):
    """Freeze the application record on the job's Applications row. Returns (page, outcome) with
    outcome 'recorded' or 'exists' (already frozen; force=True rewrites it)."""
    now = now or datetime.now(timezone.utc)
    row = tracker.find(url)
    if not row:
        raise LookupError(f'No Applications row for {url}')
    form = form_snapshot(url, snapshot_dir)
    # An existing record is kept, unless it only had kit drafts and the submitted form is now known
    # (e.g. ✅ tapped in Telegram before the watcher saw the confirmation page).
    upgrade = form and plain(row['properties'].get('Answers captured')) != 'Form'
    if plain(row['properties'].get('Recorded')) and not (force or upgrade):
        return row, 'exists'
    kit = tracker.read_kit(row['id'], kit_module.KIT_HEADING)
    run = run_state(url, run_dir)
    if run is None and hasattr(tracker, '_request'):
        run = run_from_notion(tracker, row)
    properties, data = build(url, row, kit, match_for(tracker, url), posting(url),
                             form, run, cv_version(cv_path), now)
    tracker.update_page(row['id'], properties)
    tracker.replace_section(row['id'], RECORD_HEADING, record_blocks(data))
    return row, 'recorded'


def add_event(tracker, page, kind, source, *, at=None, note=''):
    """One 📈 Application Events row linked to the Applications page."""
    props = page['properties']
    if not at and kind == 'Applied':
        at = plain(props.get('Applied on'))  # the application's own date, never "now" for an old one
    at = at or datetime.now(timezone.utc).isoformat(timespec='seconds')
    company = plain(props.get('Company')) or plain(props.get('Job')) or 'application'
    properties = {
        'Event': {'title': [{'text': {'content': f'{kind} · {company}'[:200]}}]},
        'Application': {'relation': [{'id': page['id']}]},
        'Kind': {'select': {'name': kind}},
        'At': {'date': {'start': at}},
        'Source': {'select': {'name': source}},
        'Note': _text(note),
    }
    url = plain(props.get('Job URL'))
    if url:
        properties['Job URL'] = {'url': url}
    return tracker.create_page(EVENTS_DATABASE_ID, properties)


def mark_applied(tracker, url, source='CLI', **record_options):
    """Stage -> Applied, an Applied event, and the frozen record. The record never blocks the
    marking: a failure there is reported, and `record --force` can redo it later."""
    page, outcome = tracker.mark({'url': url}, 'Applied')
    lines = [f'{url}: {outcome}']
    if outcome != 'unchanged':
        add_event(tracker, page, 'Applied', source)
    try:
        _, recorded = record(tracker, url, **record_options)
        lines.append(f'application record: {recorded}')
    except Exception as error:  # noqa: BLE001 — marking must succeed even if the snapshot can't
        lines.append(f'application record skipped: {type(error).__name__}: {error}')
    return '\n'.join(lines)


def set_stage(tracker, url, stage, source='CLI', note=''):
    """Move an application to an outcome stage and log the event."""
    if stage not in EVENT_KINDS:
        raise ValueError(f'Stage must be one of: {", ".join(EVENT_KINDS)}')
    if stage == 'Applied':
        return mark_applied(tracker, url, source)
    row = tracker.find(url)
    if not row:
        raise LookupError(f'No Applications row for {url}')
    if stage != REPLY:  # a reply is an event only; Stage stays where it is
        changes = {'Stage': {'select': {'name': stage}}}
        if stage == 'Rejected' and not plain(row['properties'].get('Feedback status')):
            from .. import feedback
            if plain(row['properties'].get('Stage')) in feedback.REACHED or feedback.eligible(row, feedback.history_for(tracker, row)):
                changes['Feedback status'] = {'select': {'name': 'Not asked'}}
        tracker.update_page(row['id'], changes)
    add_event(tracker, row, stage, source, note=note)
    return f'{url}: {stage}'


def moment(value):
    """An event time as a comparable UTC datetime. A date without a time counts as midnight in the
    owner's time zone (JOB_PILOTTO_TZ), so "2026-09-26" sorts before a 01:26 email that day even
    when Notion returns the email in UTC ("2026-09-25T23:26Z"). Unparseable -> the earliest time."""
    from zoneinfo import ZoneInfo
    value = (value or '').replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(os.getenv('JOB_PILOTTO_TZ', 'Europe/Zurich')))
    return parsed.astimezone(timezone.utc)


def latest_events(tracker):
    """Applications page id -> {'kind', 'at'} of its latest Stage-type event, plus 'last' (time of its
    latest event of any kind) and 'replied' (whether a Reply received event exists)."""
    latest = {}
    for event in tracker.query_database(EVENTS_DATABASE_ID):
        props = event['properties']
        at, kind = plain(props.get('At')) or '', plain(props.get('Kind'))
        for link in (props.get('Application') or {}).get('relation', []):
            item = latest.setdefault(link['id'].replace('-', ''), {'kind': None, 'at': '', 'last': '', 'replied': False})
            item['last'] = max(item['last'], at, key=moment) if item['last'] else at
            item['replied'] |= kind == REPLY
            if kind in OUTCOME_STAGES and (not item['at'] or moment(at) >= moment(item['at'])):
                item.update(kind=kind, at=at)
    return latest


def sync(tracker, now=None, no_response_days=NO_RESPONSE_DAYS, dry_run=False):
    """Log Stage changes made by hand in Notion as events, and move applications with no reply
    after no_response_days to No response. Returns a one-line summary."""
    now = now or datetime.now(timezone.utc)
    rows = tracker.query_database(tracker.database_id, {'or': [
        {'property': 'Stage', 'select': {'equals': stage}} for stage in OUTCOME_STAGES]})
    latest = latest_events(tracker)
    logged, silent = 0, 0
    for row in rows:
        props = row['properties']
        stage = plain(props.get('Stage'))
        info = latest.get(row['id'].replace('-', ''), {'kind': None, 'at': '', 'last': '', 'replied': False})
        last_at = info['last']
        if info['kind'] != stage:
            when = plain(props.get('Applied on')) if stage == 'Applied' else row.get('last_edited_time')
            if not dry_run:
                source, note = (('Backfill', 'First event for an application tracked before the ledger')
                                if info['kind'] is None else
                                ('Notion edit', 'Stage changed in Notion; time is when the row was last edited'))
                add_event(tracker, row, stage, source, at=when or now.isoformat(timespec='seconds'), note=note)
            logged, last_at = logged + 1, max(last_at, when or '', key=moment)
        applied = _day(plain(props.get('Applied on')))
        last = _day(last_at) or applied
        if (stage in WAITING_STAGES and not info['replied'] and applied and last
                and (now.date() - last).days >= no_response_days):
            if not dry_run:
                tracker.update_page(row['id'], {'Stage': {'select': {'name': 'No response'}}})
                add_event(tracker, row, 'No response', 'Auto rule',
                          note=f'No reply {(now.date() - applied).days} days after applying')
            silent += 1
    return f'Ledger sync: {len(rows)} applications, {logged} stage change(s) logged, {silent} moved to No response.'


MONTHS = {m: i for i, m in enumerate(
    ('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'), 1)}


NUMBER_WORDS = {'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7,
                'eight': 8, 'nine': 9, 'ten': 10, 'a couple of': 2, 'couple of': 2, 'a few': 3, 'few': 3}


def _relative(text, today):
    """A date from "today", "yesterday", "two days ago", "3 weeks ago", "last week" (a week ago), else None."""
    from datetime import timedelta
    if re.search(r'\btoday\b', text):
        return today
    if re.search(r'\byesterday\b', text):
        return today - timedelta(days=1)
    if re.search(r'\blast week\b', text):
        return today - timedelta(days=7)
    words = '|'.join(sorted(map(re.escape, NUMBER_WORDS), key=len, reverse=True))
    if m := re.search(rf'\b(\d+|{words})\s+(day|week|month)s?\s+ago\b', text):
        count = int(m[1]) if m[1].isdigit() else NUMBER_WORDS[m[1]]
        return today - timedelta(days=count * {'day': 1, 'week': 7, 'month': 30}[m[2]])
    return None


def parse_applied(text, today=None):
    """(date or None, approximate) from "2026-09-23", "23 Sep", "23.09", "on or before 23 Sep", "~23/9", or
    "today", "yesterday", "two days ago", "3 weeks ago", "last week" (weeks and months ago count as approximate).
    A year-less date in the future is taken as last year's."""
    today = today or date.today()
    text = (text or '').strip().lower()
    if not text:
        return None, False
    approx = bool(re.search(r'before|approx|around|about|~|<=|≤|ca\.?\b|week|month|few|couple', text))
    if (relative := _relative(text, today)) is not None:
        return relative, approx
    found = None
    if m := re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', text):
        found = (int(m[1]), int(m[2]), int(m[3]))
    elif m := re.search(r'(\d{1,2})\s*(?:\.|/|\s)\s*([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?', text):
        if m[2] in MONTHS:
            found = (int(m[3]) if m[3] else None, MONTHS[m[2]], int(m[1]))
    elif m := re.search(r'([a-z]{3})[a-z]*\s+(\d{1,2})(?:,?\s+(\d{4}))?', text):
        if m[1] in MONTHS:
            found = (int(m[3]) if m[3] else None, MONTHS[m[1]], int(m[2]))
    elif m := re.search(r'(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?', text):
        found = (int(m[3]) if m[3] else None, int(m[2]), int(m[1]))
    if not found:
        raise ValueError(f'Could not read a date from "{text}". Try 2026-09-23, 23 Sep, "two days ago" or "on or before 23 Sep".')
    year, month, day = found
    value = date(year or today.year, month, day)
    if year is None and value > today:
        value = date(today.year - 1, month, day)
    return value, approx


# Sites whose pages are never fetched (terms, login walls): the title, company and text come from you instead.
NO_FETCH = ('linkedin.com', 'glassdoor.', 'indeed.', 'levels.fyi', 'reddit.com')


def no_fetch(url):
    host = (re.match(r'https?://([^/]+)', url or '') or [None, ''])[1].lower()
    return any(site in host for site in NO_FETCH)


def page_meta(url, opener=urllib.request.urlopen):
    """Title, company, location, posting date and description of a job page: the job board's API when
    supported (ats.posting), else the page's schema.org JobPosting (most job sites publish one). Never for
    NO_FETCH sites (LinkedIn, Glassdoor…): {} there."""
    if no_fetch(url):
        return {}
    meta = dict(ats.posting(url) or {})
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Job Pilotto)'})
        with opener(request, timeout=20) as response:
            page = response.read().decode('utf-8', errors='replace')
    except Exception:  # noqa: BLE001 — a page we can't read still gets tracked with what we have
        return meta
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', page, re.S):
        try:
            data = _json.loads(block)
        except ValueError:
            continue
        for item in data if isinstance(data, list) else data.get('@graph', [data]):
            if isinstance(item, dict) and item.get('@type') == 'JobPosting':
                place = item.get('jobLocation') or {}
                place = place[0] if isinstance(place, list) and place else place
                address = place.get('address') if isinstance(place, dict) else None
                if isinstance(address, dict):
                    address = ', '.join(v for v in (address.get('addressLocality'), address.get('addressCountry'))
                                        if isinstance(v, str) and v)
                meta.setdefault('title', item.get('title'))
                meta.setdefault('company', (item.get('hiringOrganization') or {}).get('name'))
                meta.setdefault('location', address)
                meta.setdefault('date_posted', item.get('datePosted'))
                meta.setdefault('description', re.sub(r'<[^>]+>', ' ', html.unescape(item.get('description') or '')))
                return {k: v for k, v in meta.items() if v}
    if not meta.get('title') and (m := re.search(r'<title>(.*?)</title>', page, re.S)):
        meta['title'] = html.unescape(m[1]).strip()
    return meta


def company_for(tracker, url, meta):
    """The employer of a job page: its metadata, else the scored job's (job board APIs often omit it), else the
    board's slug in the URL."""
    if meta.get('company'):
        return meta['company']
    found = ats.detect(url)
    return match_for(tracker, url).get('Company') or (found[1].replace('-', ' ').title() if found else '')


def add_application(tracker, url, *, applied=None, approx=False, channel=None, via=None, source='CLI',
                    meta=None, today=None):
    """Track an application made outside Job Pilotto (or before it): the Applications row, an Applied
    event on the application's date, and the frozen record. Returns a one-line summary."""
    today = today or date.today()
    applied = applied or today
    meta = dict(meta if meta is not None else page_meta(url))
    meta['company'] = company_for(tracker, url, meta)
    guess_channel, guess_via = channel_for(url)
    channel, via = channel or guess_channel, via if via is not None else guess_via
    text = lambda value: _text(value or '')
    props = {'Stage': {'select': {'name': 'Applied'}}, 'Applied on': {'date': {'start': applied.isoformat()}},
             'Date approximate': {'checkbox': bool(approx)}, 'Channel': {'select': {'name': channel}}}
    if via:
        props['Via'] = text(via)
    row = tracker.find(url)
    if row:
        stage = plain(row['properties'].get('Stage'))
        if stage in OUTCOME_STAGES and stage != 'Applied':
            return f'Already tracked at {stage}: {plain(row["properties"].get("Job"))}'
        tracker.update_page(row['id'], props)
    else:
        posted = (meta.get('date_posted') or '')[:10]
        props.update({
            'Job': {'title': [{'text': {'content': (meta.get('title') or url)[:200]}}]},
            'Company': text(meta.get('company')), 'Location': text(meta.get('location')),
            'Job URL': {'url': url}, 'Source': {'select': {'name': 'Manual' if source == 'CLI' else source}},
        })
        if _day(posted):
            props['Posted'] = {'date': {'start': posted}}
        row = tracker.create_page(tracker.database_id, props)
    row = tracker.find(url) or row
    add_event(tracker, row, 'Applied', source, at=applied.isoformat(),
              note='Applied outside Job Pilotto' + ('; date is an upper bound (on or before)' if approx else ''))
    try:
        _, recorded = record(tracker, url, posting=lambda _url: meta)
    except Exception as error:  # noqa: BLE001
        recorded = f'record skipped: {type(error).__name__}'
    title = plain(row['properties'].get('Job')) or meta.get('title') or url
    company = plain(row['properties'].get('Company')) or meta.get('company') or '?'
    when = ('on or before ' if approx else '') + applied.isoformat()
    return f'Tracked: {title} — {company}, applied {when} ({channel}{f" via {via}" if via else ""}); {recorded}'


def backfill(tracker, **record_options):
    """Freeze a record for every application in an outcome stage that has none yet (applications
    tracked before the ledger existed). Returns one line per application."""
    rows = tracker.query_database(tracker.database_id, {'or': [
        {'property': 'Stage', 'select': {'equals': stage}} for stage in OUTCOME_STAGES]})
    lines = []
    for row in rows:
        url = plain(row['properties'].get('Job URL'))
        if not url or plain(row['properties'].get('Recorded')):
            continue
        try:
            _, outcome = record(tracker, url, **record_options)
        except Exception as error:  # noqa: BLE001 — one bad row shouldn't stop the others
            outcome = f'skipped: {type(error).__name__}: {error}'
        lines.append(f'{plain(row["properties"].get("Company")) or "?"} — {plain(row["properties"].get("Job"))}: {outcome}')
    return lines or ['Nothing to backfill.']


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    rec = sub.add_parser('record', help="freeze the application record on a job's Applications row")
    rec.add_argument('url')
    rec.add_argument('--force', action='store_true', help='rewrite an existing record')
    ev = sub.add_parser('event', help='move an application to an outcome stage and log the event')
    ev.add_argument('url')
    ev.add_argument('stage', choices=EVENT_KINDS)
    ev.add_argument('--note', default='')
    ev.add_argument('--source', default='CLI', choices=('CLI', 'Watcher', 'Telegram', 'Backfill'))
    sy = sub.add_parser('sync', help='log hand-edited stages and apply the no-response rule')
    sy.add_argument('--dry-run', action='store_true')
    sub.add_parser('backfill', help='record every tracked application that has no record yet')
    ad = sub.add_parser('add', help='track an application made outside Job Pilotto')
    ad.add_argument('url')
    ad.add_argument('--applied', default='', help='"2026-09-23", "23 Sep", "on or before 23 Sep" (default today)')
    ad.add_argument('--channel', choices=CHANNELS)
    ad.add_argument('--via', help='recruiter platform or agency, e.g. TechTree')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required (Keychain entry job-pilotto.notion.token, or export it)')
    if args.command == 'record':
        _, outcome = record(tracker, args.url, force=args.force)
        print(f'{args.url}: {outcome}')
    elif args.command == 'event':
        print(set_stage(tracker, args.url, args.stage, args.source, args.note))
    elif args.command == 'add':
        applied, approx = parse_applied(args.applied)
        print(add_application(tracker, args.url, applied=applied, approx=approx, channel=args.channel, via=args.via))
    elif args.command == 'backfill':
        print('\n'.join(backfill(tracker)))
    else:
        print(sync(tracker, dry_run=args.dry_run))
    return 0


if __name__ == '__main__':
    sys.exit(main())
