"""Interview analysis, what is written: the Interviews page (job line, review blocks, transcript), its row properties and
the Telegram summary. Re-exported by src/ai/interviews.py. Tests: tests/test_interviews_saved.py, tests/test_interviews_focus.py.
"""
from html import escape

from .. import tgcard
from ..notion import titles
from ..notion.ledger import plain
from ..notion.titles import named
from .interviews_facts import fact_lines


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


def page_blocks(result, transcript, merged=None):
    """Analysis first, then the full transcript in a toggle (within Notion's 100 blocks per request)."""
    return analysis_blocks(result, merged) + [transcript_toggle(transcript)]


def interview_title(company, round_, app=None):
    """"Company · Round": the employer if named (in the call, else the application's Company), else the application's
    Via (agency), else its job title, else just the round."""
    app = app or {}
    name = (named(company) or named(app.get('company') or '') or named(app.get('via') or '')
            or named(titles.role_of(app.get('title') or '', app.get('company') or '', app.get('via') or '')))
    return ' · '.join(part for part in (name, (round_ or '').strip()) if part)[:200] or 'Interview'


def review_fields(result, app, today, model, usd, source):
    """The reviewed interview's fields (src/stores/base.py INTERVIEW_FIELDS), without the review text itself.
    source: 'Recording', 'Transcript' or 'Notes' (older callers pass True/False for transcript/notes)."""
    source = {True: 'Transcript', False: 'Notes'}.get(source, source)
    topics = list(dict.fromkeys(q['topic'] for q in result['questions']))
    weak = list(dict.fromkeys(q['topic'] for q in result['questions'] if q['quality'] in ('weak', 'not_answered')))
    fields = {'title': interview_title(result['company'], result['round'], app), 'at': today.isoformat(),
              'round': result['round'][:2000], 'overall': result['overall'], 'questions': len(result['questions']),
              'weak_answers': sum(q['quality'] in ('weak', 'not_answered') for q in result['questions']),
              'topics': '; '.join(topics)[:2000], 'weak_topics': '; '.join(weak)[:2000], 'next_step': result['next_step'][:2000],
              'input': source, 'cost': round(usd, 4), 'model': model}
    if app:
        fields['app_id'] = app['id']
    return fields


def message(result, app, page_url, usd, truncated=False, merged=None, stage=None):
    title = (tgcard.dot(app.get('company') or '', titles.role_of(app.get('title') or '', app.get('company') or '', app.get('via') or ''))
             if app else f"{named(result['company']) or 'Unknown company'} · not linked to an application")
    weak = [q for q in result['questions'] if q['quality'] in ('weak', 'not_answered')]
    blocks = [tgcard.block(escape(title), escape(result['summary']))]
    if result['strengths']:
        blocks.append(tgcard.block('Strong', *[f'• {escape(s)}' for s in result['strengths'][:3]]))
    if weak:
        blocks.append(tgcard.block(f'Weak answers ({len(weak)} of {len(result["questions"])})', *[
            f"• {escape(q['topic'])}: {escape(q['better'] or q['question'])}" for q in weak[:3]]))
    if result['practice']:
        blocks.append(tgcard.block('Practise', *[f'• {escape(p)}' for p in result['practice'][:3]]))
    blocks.append(tgcard.block('Next step', escape(result['next_step']), f'Stage → {escape(stage)}' if stage else ''))
    extra = changes_lines(merged)
    if extra:
        blocks.append(tgcard.block('Changes', *extra))
    notes = (['The transcript was very long; only the first part was analysed.'] if truncated else []) \
        + ([] if app else ['Link it to its application in Notion (Application column).'])
    if notes:
        blocks.append('\n'.join(escape(n) for n in notes))
    return tgcard.card('Interview review', result['round'], blocks, emoji='🎤',
                       footer=f'<a href="{escape(page_url, quote=True)}">Full analysis and transcript</a> · ${usd:.3f}')


def changes_lines(merged):
    """What the call filled on the job, and where it said something else (Telegram lines)."""
    if not merged:
        return []
    lines = []
    if merged['filled']:
        lines.append('Added to the job: ' + escape('; '.join(f"{f['label']}: {f['value']}" for f in merged['filled'])))
    for fact in merged['differs']:
        lines.append(f"{escape(fact['label'])}: the call said “{escape(fact['value'])}”, the job says "
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
