#!/usr/bin/env python3
"""Interview insights: what your reviewed interviews say together, for the Interviews page and 💡 Insights.

Event-driven, not scheduled: it runs right after an interview review is saved (src/daily.py --mode interview, on
this Mac or on GitHub) and from the Interviews page's Refresh (`python -m src.ai.interview_insights refresh`).
Input is the reviews already in Notion 🎤 Interviews (Round, Overall, Topics, Weak topics, Next step, and the
review's summary, strengths, weak spots and practice lines from the page), never the transcripts. One Claude call
(the interview review's model) writes a headline, 2-4 patterns and 1-3 things to do before the next interview.

Honesty is checked in code, not only asked for: every piece of evidence must quote its interview's review word for
word, or it is dropped; a pattern backed by fewer than MIN_SUPPORT interviews is marked tentative (always, with one
interview); a to-do must cite an interview. Nothing useful in the reviews: it says so.

It never spends twice on the same input: the reviewed rows' fingerprint (Input hash) is kept on the one 💡 Insights
row (Category "Interview patterns", upserted), and an unchanged set skips the call. At 90% of the monthly AI budget
(budget.py 'pause') it waits, like the other optional AI steps.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import sys
import urllib.error

from ..notion import client as notion, titles
from ..notion.ledger import plain
from . import engine
from . import budget, cost, interviews

CATEGORY = 'Interview patterns'
BASIS = 'Interviews'
MIN_SUPPORT = 2  # interviews a pattern needs before it is stated as a pattern
ROUND_TYPES = ('Recruiter screen', 'Technical', 'Hiring manager', 'Other')
REVIEW_SECTIONS = {'Strengths': 'strengths', 'Weak spots': 'weak_spots', 'Practise before the next round': 'practice',
                   'Signals from them': 'signals', 'Could count against you': 'against'}
MAX_REVIEW_CHARS = 8000
# The transcripts of the newest interviews, so a pattern can be checked against what was said (owner, 30 Sep 2026). A 30-minute
# call is ~25k characters; the budget keeps a refresh around $0.05-0.08 with Sonnet. Older ones: their review only.
TRANSCRIPT_CHARS = 30000
TRANSCRIPT_BUDGET = 75000


def insights_db():
    return os.getenv('NOTION_INSIGHTS_DB', '')


def model():
    return interviews.DEFAULT_MODEL


def round_type(round_):
    """Recruiter screen, Technical, Hiring manager or Other, from the review's Round ("Technical screen" is technical)."""
    text = round_ or ''
    if re.search(r'\b(technical|tech|system design|coding|live coding|pair(ing)?|take[- ]home|architecture|design|whiteboard)\b', text, re.I):
        return 'Technical'
    if re.search(r'\b(hiring manager|hm|manager|behaviou?ral|culture|values|final|director|vp|cto)\b', text, re.I):
        return 'Hiring manager'
    if interviews.SCREEN.search(text):
        return 'Recruiter screen'
    return 'Other'


# ---------- input: the reviewed rows, and a fingerprint of them ----------

FINGERPRINT_COLUMNS = ('Interview', 'Round', 'Overall', 'Topics', 'Weak topics', 'Next step', 'Questions', 'Weak answers', 'Date')


def reviewed_rows(tracker):
    """🎤 Interviews rows with a review (Overall set), oldest first."""
    if not interviews.INTERVIEWS_DATABASE_ID:
        return []
    rows = [r for r in tracker.query_database(interviews.INTERVIEWS_DATABASE_ID) if plain(r['properties'].get('Overall'))]
    return sorted(rows, key=lambda r: (plain(r['properties'].get('Date')) or '', r['id']))


def fingerprint(rows):
    """The same reviewed interviews with the same review columns -> the same value (order doesn't matter)."""
    items = sorted([r['id'].replace('-', ''), [plain(r['properties'].get(c)) for c in FINGERPRINT_COLUMNS],
                    sorted(l['id'].replace('-', '') for l in (r['properties'].get('Application') or {}).get('relation', []))]
                   for r in rows)
    return hashlib.sha256(json.dumps(items, ensure_ascii=False, default=str).encode()).hexdigest()[:24]


def review_text(tracker, page_id):
    """The review on an interview page, by section: {'summary', 'strengths', 'weak_spots', 'practice', 'signals',
    'weak_answers', 'mixed_answers', 'against'}: ⚠️/❌ questions are weak answers, ➖ ones mixed (their "Better:" lines matter
    too). The transcript is read separately (transcript_of)."""
    out = {'summary': '', 'strengths': [], 'weak_spots': [], 'practice': [], 'signals': [], 'weak_answers': [], 'mixed_answers': [],
           'against': []}
    section = None
    for block in tracker._children(page_id):
        kind = block.get('type')
        body = block.get(kind) or {}
        text = plain({'type': 'rich_text', 'rich_text': body.get('rich_text', [])}) or ''
        if kind == 'heading_3':
            if text == 'Transcript':
                break
            section = 'questions' if text == 'Questions' else REVIEW_SECTIONS.get(text, 'other')
        elif kind == 'paragraph' and section is None and text and not text.startswith('🔗') and text != interviews.PLACEHOLDER:
            out['summary'] = out['summary'] or text
        elif kind == 'bulleted_list_item' and section in out:
            out[section].append(text)
        elif kind == 'bulleted_list_item' and section == 'questions' and text.startswith(('⚠️', '❌')):
            out['weak_answers'].append(text)
        elif kind == 'bulleted_list_item' and section == 'questions' and text.startswith('➖'):
            out['mixed_answers'].append(text)
    return out


def transcript_of(tracker, page_id, limit):
    """The interview's saved transcript, at most `limit` characters; '' when it has none or it can't be read."""
    if limit <= 0:
        return ''
    try:
        return interviews.saved_transcript(tracker, page_id)[:limit]
    except Exception:  # noqa: BLE001 - notes without a transcript, an older page: the review alone
        return ''


def _app(tracker, app_id, seen):
    if app_id not in seen:
        try:
            props = tracker._request('GET', f'pages/{app_id}')['properties']
            seen[app_id] = {'company': plain(props.get('Company')) or plain(props.get('Via')) or '', 'job': titles.row_role(props)}
        except Exception:  # noqa: BLE001 - a trashed or unshared application: the interview still counts
            seen[app_id] = {}
    return seen[app_id]


def gather(tracker, rows):
    """The model's input, one entry per reviewed interview, labelled I1, I2… (oldest first)."""
    items, apps = [], {}
    for n, row in enumerate(rows, 1):
        p = row['properties']
        relation = (p.get('Application') or {}).get('relation', [])
        app = _app(tracker, relation[0]['id'], apps) if relation else {}
        review = review_text(tracker, row['id'])
        split = lambda value: [t.strip() for t in (value or '').split(';') if t.strip()]
        items.append({
            'label': f'I{n}', 'id': row['id'], 'url': row.get('url', ''), 'title': plain(p.get('Interview')) or 'Interview',
            'date': plain(p.get('Date')) or '', 'round': plain(p.get('Round')) or '', 'round_type': round_type(plain(p.get('Round'))),
            'company': app.get('company', ''), 'job': app.get('job', ''), 'outcome': plain(p.get('Overall')) or '',
            'topics': split(plain(p.get('Topics'))), 'weak_topics': split(plain(p.get('Weak topics'))),
            'next_step': plain(p.get('Next step')) or '', **review})
    left = TRANSCRIPT_BUDGET  # newest first: the latest interviews matter most
    for item in reversed(items):
        item['transcript'] = transcript_of(tracker, item['id'], min(TRANSCRIPT_CHARS, left))
        left -= len(item['transcript'])
    return items


def _source(item):
    """Everything a quote from this interview may come from (the review, not the transcript)."""
    parts = [item['summary'], item['next_step'], item['round'], *item['topics'], *item['weak_topics'],
             *item['strengths'], *item['weak_spots'], *item['practice'], *item['signals'], *item['weak_answers'],
             *item.get('mixed_answers', []), *item.get('against', []), item.get('transcript', '')]
    return _norm(' \n '.join(p for p in parts if p))


def _norm(text):
    return re.sub(r'\s+', ' ', (text or '').replace('“', '"').replace('”', '"').replace('’', "'")).strip().casefold()


def prompt_input(items):
    """Grouped by round type, so screens and technical rounds are never read as one."""
    groups = {}
    for item in items:
        view = {k: item[k] for k in ('label', 'date', 'round', 'company', 'job', 'outcome', 'topics', 'weak_topics', 'next_step',
                                     'summary', 'strengths', 'weak_spots', 'practice', 'signals', 'weak_answers')}
        view.update(mixed_answers=item.get('mixed_answers', []), could_count_against=item.get('against', []))
        if len(json.dumps(view, ensure_ascii=False)) > MAX_REVIEW_CHARS:  # a very long review: fewer answers, every signal kept
            view['weak_answers'], view['mixed_answers'] = view['weak_answers'][:6], view['mixed_answers'][:4]
        if item.get('transcript'):
            view['transcript'] = item['transcript']
        groups.setdefault(item['round_type'], []).append(view)
    return {'interviews_reviewed': len(items), 'by_round_type': {t: groups[t] for t in ROUND_TYPES if t in groups}}


# ---------- the one AI call ----------

KINDS = ('weakness', 'strength', 'note')  # the icon of a pattern on the card
# 2 = the redesigned card's words (titles, kinds, keyword lines, the banner sentence). A saved insight of an older version is
# regenerated once on Refresh even when no review changed, so it fills them in.
DATA_VERSION = 6  # 6 = one moment backs one pattern, three kinds of gap, strengths kept, "you" (30 Sep 2026)

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['nothing_useful', 'headline', 'headline_detail', 'patterns', 'next_steps', 'confidence'],
    'properties': {
        'nothing_useful': {'type': 'boolean', 'description': 'true only when the reviews give nothing to conclude or act on'},
        'headline': {'type': 'string', 'description': 'One sentence, max 120 characters: the most useful conclusion'},
        'headline_detail': {'type': 'string', 'description': 'One sentence, max 120 characters, under the headline: what the same pattern covered ("The same pattern appeared in tenure and unblocking questions"); "" when there is nothing to add'},
        'patterns': {'type': 'array', 'description': '0-4 patterns, most useful first', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['round_type', 'title', 'kind', 'pattern', 'evidence'],
            'properties': {
                'round_type': {'type': 'string', 'enum': list(ROUND_TYPES) + ['All']},
                'title': {'type': 'string', 'description': 'The recurring behaviour in plain words, max 55 characters: what the candidate does and when ("Answers stay general when asked for a named example", "Rambles on questions about their own choices"); never a vague label like "gaps in specifics" or "soft-skill issues", and not one topic ("can\'t name IoT protocols")'},
                'kind': {'type': 'string', 'enum': list(KINDS), 'description': 'weakness = something that costs you; strength = something that lands well; note = anything else'},
                'pattern': {'type': 'string', 'description': 'One or two short sentences, max 200 characters, with at least two concrete instances from different interviews: what was asked and what was missing, in the reviews\' words ("IoT protocols (Zephyr), AWS certification (Huxley)")'},
                'evidence': {'type': 'array', 'items': {
                    'type': 'object', 'additionalProperties': False, 'required': ['interview', 'quote'],
                    'properties': {'interview': {'type': 'string', 'description': 'The label, e.g. "I2"'},
                                   'quote': {'type': 'string', 'description': 'Words copied exactly from that interview\'s review, at most 25 words'}}}},
            }}},
        'next_steps': {'type': 'array', 'description': '1-3 concrete things to do before the next interview', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['action', 'title', 'focus', 'interviews'],
            'properties': {'action': {'type': 'string', 'description': 'max 140 characters'},
                           'title': {'type': 'string', 'description': 'What to do, naming the concrete thing, max 55 characters ("Learn the IoT protocol basics"; not "Close the gaps")'},
                           'focus': {'type': 'string', 'description': 'The concrete topics from the reviews, 2-4 short keywords joined by " • ", max 70 characters ("MQTT • CoAP • AWS certification"); "" if none'},
                           'interviews': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Labels it comes from'}}}},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
}

SYSTEM = f"""You read the candidate's own interview reviews (made by Job Pilotto from their interviews) and say what \
they show together, so the next interview goes better. You get the reviews grouped by round type (recruiter screen, \
technical, hiring manager, other); each interview has a label (I1, I2…).

Rules:
- Only what the reviews say. Never invent interviews, questions, companies, numbers or feedback.
- Every piece of evidence copies words exactly from that interview's review (summary, strengths, weak spots, practice, \
signals, weak answers, topics, next step) and names its label. No paraphrased quotes.
- A pattern needs at least {MIN_SUPPORT} different interviews behind it. With fewer, write it as an observation from \
that one interview ("In I1, …"), not as something that keeps happening.
- Keep round types apart: don't draw one conclusion from a recruiter screen and a technical round together unless \
the same thing clearly shows in both; set round_type to the group it comes from ("All" only then).
- next_steps: 1-3 concrete things to practise or prepare before the next interview, each citing the interviews it comes from.
- A pattern is a behaviour that recurs across interviews, said plainly: what the candidate does and when ("Answers stay \
general when asked for a named example"). It is not a single topic ("can't name IoT protocols" is one finding, not a \
pattern) and not a vague label ("gaps in specifics", "technical credentials").
- Name the instances. The concrete topics from the reviews are the evidence: in the detail, name at least two instances from \
different interviews with what was asked and what was missing (IoT protocols in one, an AWS certification in another). \
Use the reviews' own nouns. A behaviour you can't back with named instances from two interviews is dropped: fewer, \
sharper patterns beat generic ones; one interview's single topic is at most an observation ("In I1, …").
- Evidence for a pattern includes a quote from each interview it claims, the sentence that shows the instance. Every \
instance you name belongs to the interview it happened in: check it there before you attribute it.
- Merge only the same behaviour, never the same category: not knowing a protocol, not holding a certification and a \
long-winded answer are three different things, even if all are "about specifics".
- Look first at how the answers met what the interviewer said they need (a client's stated pain points, the role's focus): \
missing that in several interviews is often the most useful pattern.
- When a strength and a weakness touch (honest about a gap vs underselling it), say how to keep the strength.
- Before grouping, sort every weak moment into one of three kinds and never mix them in a pattern: a knowledge gap (asked \
directly and did not know, e.g. could not name IoT protocols), a volunteered gap (offered a limit unprompted), or a delivery \
problem (the answer was long, unstructured, off the question or had no outcome). A gap counts as "without a bridge" only \
if the answer stopped there: check the transcript, and when related experience followed, it is not that pattern.
- Each moment (a question and its answer) backs one pattern only: pick the pattern it shows best.
- Include at least one strength when the reviews show one landing well in more than one interview; it tells the \
candidate what to keep doing.
- Address the candidate as "you" in every sentence, never "he" or "the candidate"
- You also get the transcript of the newest interviews (speech-to-text, so words can be garbled). Use it to check what was \
actually asked and answered; quote it only for a clear, readable sentence. The review stays the main source.
- Each pattern also gets a short title and a kind (weakness / strength / note); each step a short heading and a keyword \
line of the topics to cover; the headline gets one line under it (headline_detail). Same rules: only what the reviews say.
- confidence: low with 1-2 interviews or thin reviews; medium with 3-5 consistent ones; high only with more and consistent evidence.
- If the reviews contain nothing useful to conclude, set nothing_useful=true, say so in the headline, leave the lists empty.
- Direct and specific, like a sharp colleague. No filler, no encouragement, no emojis.
"""


def generate(client, model_, items):
    """(result dict, usage, the model that answered) from one schema-constrained call (interviews.ask: a declined request is
    answered by the fallback model)."""
    return interviews.ask(client, model_, max_tokens=interviews.MAX_TOKENS,
                          system=[{'type': 'text', 'text': SYSTEM}],
                          messages=[{'role': 'user', 'content': 'Reviewed interviews (JSON):\n' + json.dumps(prompt_input(items), ensure_ascii=False)}],
                          output_config=engine.structured(SCHEMA, model_))


def validate(result, items):
    """Only what the reviews support: evidence quoted word for word from the interview it names, patterns with fewer
    than MIN_SUPPORT interviews marked tentative, to-dos citing a real interview. Returns the stored shape."""
    by_label = {item['label']: item for item in items}
    sources = {label: _source(item) for label, item in by_label.items()}
    patterns, used = [], set()
    for pattern in result.get('patterns') or []:
        evidence = []
        for ref in pattern.get('evidence') or []:
            label, quote = (ref.get('interview') or '').strip(), (ref.get('quote') or '').strip().strip('"“”')
            # a quote backs one pattern only (the first that uses it): the same moment never counts twice
            if label in by_label and len(quote) >= 8 and _norm(quote) in sources[label] and (label, _norm(quote)) not in used:
                used.add((label, _norm(quote)))
                evidence.append({'interview': by_label[label]['id'], 'quote': quote[:300]})
        cited = list(dict.fromkeys(e['interview'] for e in evidence))
        if not evidence or not (pattern.get('pattern') or '').strip():
            continue
        patterns.append({'text': pattern['pattern'].strip()[:200], 'title': (pattern.get('title') or '').strip()[:80],
                         'kind': pattern.get('kind') if pattern.get('kind') in KINDS else 'note',
                         'round_type': pattern.get('round_type') or 'Other',
                         'interviews': cited, 'evidence': evidence[:4], 'tentative': len(cited) < MIN_SUPPORT})
    steps = []
    for step in result.get('next_steps') or []:
        cited = list(dict.fromkeys(by_label[l]['id'] for l in step.get('interviews') or [] if l in by_label))
        if cited and (step.get('action') or '').strip():
            steps.append({'text': step['action'].strip()[:200], 'title': (step.get('title') or '').strip()[:80],
                          'focus': (step.get('focus') or '').strip()[:100], 'interviews': cited})
    n = len(items)
    confidence = result.get('confidence') if result.get('confidence') in ('high', 'medium', 'low') else 'low'
    if n < 3 or not any(not p['tentative'] for p in patterns):
        confidence = 'low'
    nothing = bool(result.get('nothing_useful')) or not (patterns or steps)
    headline = (result.get('headline') or '').strip()[:200]
    if nothing:
        headline = headline if result.get('nothing_useful') and headline else \
            'Nothing to conclude yet: the reviews name no clear strength, gap or next step.'
        patterns, steps = [], []
    return {'headline': headline, 'headline_detail': '' if nothing else (result.get('headline_detail') or '').strip()[:200],
            'patterns': patterns[:4], 'next_steps': steps[:3], 'confidence': confidence,
            'nothing_useful': nothing, 'interviews': n}


# ---------- storage: one upserted 💡 Insights row ----------

def _rich(value):
    value = value or ''
    return {'rich_text': [{'text': {'content': value[i:i + 2000]}} for i in range(0, min(len(value), 100 * 2000), 2000)]}


def existing(tracker):
    """The Interview patterns row, or None (the newest if several)."""
    if not insights_db():
        return None
    try:
        rows = tracker.query_database(insights_db(), {'property': 'Category', 'select': {'equals': CATEGORY}})
    except urllib.error.HTTPError as error:
        # 400: the workspace doesn't have the "Interview patterns" option (or Category) yet, because the app's schema
        # repair hasn't run: Notion refuses a filter on an unknown option. Read the rows and pick it here instead.
        if error.code != 400:
            raise
        rows = [r for r in tracker.query_database(insights_db()) if plain((r.get('properties') or {}).get('Category')) == CATEGORY]
    return max(rows, key=lambda r: r.get('last_edited_time', '')) if rows else None


def evidence_lines(stored, items):
    names = {item['id']: item['title'] for item in items}
    lines = []
    for p in stored['patterns']:
        tag = 'Tentative, 1 interview' if p['tentative'] else f"{len(p['interviews'])} interviews"
        lines.append(f"• {p['text']} ({tag}; {p['round_type']})")
        lines += [f"    {names.get(e['interview'], 'Interview')}: “{e['quote']}”" for e in p['evidence']]
    return '\n'.join(lines) or stored['headline']


def step_key(text):
    """A to-do's identity: its words without case, spacing or punctuation. A tick on "Practice next" lives on this key, so it
    survives a Refresh only while the step's words do."""
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()[:80]


def _row_data(row):
    try:
        return json.loads(plain((row.get('properties') or {}).get('Data')) or '{}')
    except ValueError:
        return {}


def properties(stored, items, digest, model_, usd, now, done=()):
    keys = {step_key(step['text']) for step in stored['next_steps']}
    data = {'v': DATA_VERSION, 'headline_detail': stored.get('headline_detail') or '', 'patterns': stored['patterns'], 'next_steps': stored['next_steps'], 'nothing_useful': stored['nothing_useful'],
            'done_steps': [key for key in done if key in keys],
            'interviews': [{'id': i['id'], 'title': i['title'], 'url': i['url'], 'round_type': i['round_type'], 'date': i['date']}
                           for i in items],
            'updated': now.isoformat(timespec='seconds')}
    return {
        'Insight': {'title': [{'text': {'content': stored['headline'][:200]}}]},
        'Date': {'date': {'start': now.date().isoformat()}},
        'Category': {'select': {'name': CATEGORY}},
        'Basis': {'select': {'name': BASIS}},
        'Confidence': {'select': {'name': stored['confidence']}},
        'Sample size': {'number': len(items)},
        'Evidence': _rich(evidence_lines(stored, items)[:2000]),
        'Action': _rich('\n'.join(f"• {s['text']}" for s in stored['next_steps'])[:2000]),
        'Cost (USD)': {'number': round(usd, 4)},
        'Model': _rich(model_),
        'Input hash': _rich(digest),
        'Data': _rich(json.dumps(data, ensure_ascii=False)),
    }


def upsert(tracker, props, row=None):
    """Update the Interview patterns row, or create it; a column the workspace lacks yet is dropped, never the row."""
    from ..notion.cron_runs import _without_missing
    if row:
        return _without_missing(lambda p: tracker._request('PATCH', f"pages/{row['id']}", {'properties': p}), props) or row
    return _without_missing(lambda p: tracker._request('POST', 'pages', {'parent': {'database_id': insights_db()}, 'properties': p}), props)


def saved(tracker):
    """The stored insight for the app: {headline, confidence, interviews, updated, patterns, next_steps, url, evidence,
    action}, or None. Evidence/Action (text) are for a row written before its Data column existed."""
    row = existing(tracker)
    if not row:
        return None
    p = row['properties']
    try:
        data = json.loads(plain(p.get('Data')) or '{}')
    except ValueError:
        data = {}
    return {'id': row['id'], 'url': row.get('url', ''), 'headline': plain(p.get('Insight')) or '',
            'confidence': plain(p.get('Confidence')) or 'low', 'sample': plain(p.get('Sample size')) or 0,
            'updated': data.get('updated') or row.get('last_edited_time', ''),
            'version': data.get('v') or 1, 'headline_detail': data.get('headline_detail') or '', 'patterns': data.get('patterns') or [],
            'next_steps': [{**step, 'done': step_key(step.get('text')) in (data.get('done_steps') or [])}
                           for step in data.get('next_steps') or []], 'interviews': data.get('interviews') or [],
            'nothing_useful': bool(data.get('nothing_useful')), 'done_steps': data.get('done_steps') or [], 'evidence': plain(p.get('Evidence')) or '',
            'action': plain(p.get('Action')) or '', 'input_hash': plain(p.get('Input hash')) or '',
            'outdated': _outdated(tracker, plain(p.get('Input hash')))}


def _outdated(tracker, stored):
    """A review changed (or one was added) since the insight was written: Review again doesn't refresh it, and a review
    on GitHub writes it after the review. The card says so instead of looking current. False when it can't tell."""
    try:
        return bool(stored) and fingerprint(reviewed_rows(tracker)) != stored
    except Exception:  # noqa: BLE001 - the card shows the insight either way
        return False


def set_step_done(tracker, text, done):
    """Tick or untick one "Practice next" step, saved in the insight row's Data (Notion holds the one copy). Returns
    {'done_steps': [...]}. ValueError when there are no insights or the step isn't one of them."""
    row = existing(tracker)
    if not row:
        raise ValueError('There are no interview insights yet.')
    data = _row_data(row)
    key = step_key(text)
    if key not in {step_key(step.get('text')) for step in data.get('next_steps') or []}:
        raise ValueError('That is not a step of the current insights (Refresh may have replaced it).')
    kept = [k for k in data.get('done_steps') or [] if k != key]
    data['done_steps'] = kept + [key] if done else kept
    upsert(tracker, {'Data': _rich(json.dumps(data, ensure_ascii=False))}, row)
    return {'done_steps': data['done_steps']}


def update(tracker, *, client=None, model_=None, stats=None, now=None, force=False, budget_status=None):
    """Bring the Interview patterns row up to date with the reviews. Returns {'status', 'text', ...}: status is
    'updated', 'unchanged' (no AI call), 'none' (no reviewed interview), 'paused' (AI budget) or 'off' (no Insights
    database). force: call even when the input is unchanged (never used by the app: it would spend twice)."""
    # One refresh at a time on this Mac (the app, the terminal, a review's own refresh): the second one waits, then finds
    # the row current and makes no AI call (two paid Opus refreshes at 14:09 on 30 Sep 2026).
    from ..paths import run_lock
    with run_lock(name='insights', on_wait=lambda: print('Another interview-insights refresh is running: waiting for it…', file=sys.stderr)):
        return _update(tracker, client=client, model_=model_, stats=stats, now=now, force=force, budget_status=budget_status)


def _update(tracker, *, client, model_, stats, now, force, budget_status):
    now = now or datetime.now(timezone.utc)
    if not insights_db() or not interviews.INTERVIEWS_DATABASE_ID:
        return {'status': 'off', 'text': 'Interview insights: no 💡 Insights or 🎤 Interviews database'}
    rows = reviewed_rows(tracker)
    if not rows:
        return {'status': 'none', 'text': 'Interview insights: no reviewed interview yet'}
    digest, row = fingerprint(rows), existing(tracker)
    if row and not force and plain(row['properties'].get('Input hash')) == digest and (_row_data(row).get('v') or 1) >= DATA_VERSION:
        return {'status': 'unchanged', 'text': f'Interview insights: up to date ({len(rows)} reviewed, nothing changed)', 'usd': 0.0}
    try:
        info = (budget_status or budget.status)(tracker)
    except Exception as error:  # noqa: BLE001 - a budget read that fails never blocks it
        print(f'Warning: budget check skipped: {type(error).__name__}: {error}')
        info = {'level': 'ok'}
    if info.get('level') == 'pause':
        return {'status': 'paused', 'text': f"Interview insights: paused, AI budget at {info.get('pct', 0):.0%}"}
    items = gather(tracker, rows)
    model_ = model_ or model()
    if client is None:
        client = engine.client(action='interview')
    result, usage, model_ = generate(client, model_, items)
    cost.add(stats, model_, usage)
    usd = cost.usd(model_, usage)
    if stats is not None:
        stats['pending'] = stats.get('pending', 0) + 1
        stats['done'] = stats.get('done', 0) + 1
    stored = validate(result, items)
    done = _row_data(row).get('done_steps') or [] if row else []  # ticks stay for steps whose words are still there
    page = upsert(tracker, properties(stored, items, digest, model_, usd, now, done), row)
    return {'status': 'updated', 'usd': usd, 'url': (page or {}).get('url', ''), 'headline': stored['headline'],
            'text': f"Interview insights updated from {len(items)} interview(s): {stored['headline']} ({usd:.3f} USD)"}


def after_review(tracker, stats=None, client=None):
    """Called at the end of a saved review: never fails the review. Returns the one-line result, or ''."""
    try:
        return update(tracker, stats=stats, client=client)['text']
    except Exception as error:  # noqa: BLE001 - the review is saved; insights catch up on the next review or Refresh
        if cost.limit_reached(error):
            return ('Interview insights: paused, your Claude Code plan limit is reached' if cost.cli_limit(error)
                    else 'Interview insights: paused, the Anthropic spend limit is reached')
        return f'Interview insights skipped: {type(error).__name__}: {error}'


RUN_NAME = 'Interview insights'


def main(argv=None):
    """The Interviews page's Refresh: `refresh` prints one JSON line {ok, status, text, insight}. `step --text T --done yes|no`
    ticks or unticks a "Practice next" step and prints {ok, done_steps}."""
    import argparse
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument('command', choices=('refresh', 'step'))
    parser.add_argument('--text', default='')
    parser.add_argument('--done', choices=('yes', 'no'), default='yes')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker:
        print(json.dumps({'ok': False, 'error': 'Connect Notion first'}))
        return 1
    if args.command == 'step':
        try:
            print(json.dumps({'ok': True, **set_step_done(tracker, args.text, args.done == 'yes')}, ensure_ascii=False))
            return 0
        except (ValueError, urllib.error.URLError) as error:
            print(json.dumps({'ok': False, 'error': str(error)}))
            return 1
    from ..notion import cron_runs
    run = cron_runs.new_run('insight')
    run['insight'] = {}
    run['name'] = RUN_NAME  # "Interview insights" in the run's title, not the daily "Insight"
    try:
        out = update(tracker, stats=run['insight'])
    except Exception as error:  # noqa: BLE001 - the page says what failed
        text = cost.limit_message(error, 'the interview insights') if cost.limit_reached(error) else \
            f'Could not update the interview insights: {type(error).__name__}: {error}'
        print(json.dumps({'ok': False, 'error': text}))
        return 1
    if out['status'] == 'updated':  # a run with an AI call leaves its ⏱️ Search runs row (its cost counts for the budget)
        run['headline'] = out['text']
        run['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(run['started_at'])).total_seconds())
        cron_runs.log_run(tracker, run)
    print(json.dumps({'ok': True, 'status': out['status'], 'text': out['text'], 'insight': saved(tracker)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
