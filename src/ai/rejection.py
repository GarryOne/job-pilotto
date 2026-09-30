#!/usr/bin/env python3
"""Rejection review: why an application was turned down, and whether there's anything to improve.

After each rejection (the Gmail check runs it when a rejection email moves an application to Rejected), or on
demand (the Desktop App's job menu → "Why was I rejected?", or this command), Claude Sonnet 5 reads what Job
Pilotto keeps about the application:
- the job posting and the answers and cover letter sent (the frozen 🗂 Application record), the fit score and
  its reasons;
- the timeline (📈 Application Events: how far it got, how fast the answer came);
- the reviews of its interviews (🎤 Interviews), if any;
- the rejection email itself, when known;
- the owner's Profile (the CV).

It gives one verdict and says how sure it is:
- Presentation: the fit was there but the CV, answers or cover letter didn't show it.
- Hard skills: a missing skill, level or experience the role needed.
- Soft skills: communication, structure or seniority signals in an interview (only with interview evidence).
- Not a fit (not on you): they wanted a different profile (location, domain, level, language, a team change);
  nothing to improve.
- Unclear: not enough to tell.
The result goes on the application: "Rejection reason" and "Rejection lesson" columns and a "🔎 Why it was
rejected" section on its page (evidence, what to improve).

Usage:
  python -m src.ai.rejection --job <job URL> [--send]
  python -m src.ai.rejection --pending [--limit 3] [--send]   # every Rejected application without a review
"""
import argparse
from html import escape
import json
import os
import sys

from .. import telegram
from ..notion import client as notion, cron_runs
from ..notion.ledger import EVENTS_DATABASE_ID, RECORD_HEADING, plain
from . import cost

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_REJECTION_MODEL', os.getenv('JOB_PILOTTO_INSIGHT_MODEL', 'claude-sonnet-5'))
INTERVIEWS_DATABASE_ID = os.getenv('NOTION_INTERVIEWS_DB', '')
HEADING = '🔎 Why it was rejected'
NOT_ON_YOU = 'Not a fit (not on you)'
VERDICTS = ['Presentation', 'Hard skills', 'Soft skills', NOT_ON_YOU, 'Unclear']
EMOJI = {'Presentation': '📝', 'Hard skills': '🛠', 'Soft skills': '🗣', NOT_ON_YOU: '🤷', 'Unclear': '❔'}
MAX_DESCRIPTION = 12_000

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['verdict', 'confidence', 'stage_reached', 'summary', 'evidence', 'improve'],
    'properties': {
        'verdict': {'type': 'string', 'enum': VERDICTS},
        'confidence': {'type': 'string', 'enum': ['low', 'medium', 'high']},
        'stage_reached': {'type': 'string', 'description': 'e.g. "CV screen (no call)", "After the recruiter screen", "After the technical round"'},
        'summary': {'type': 'string', 'description': 'One sentence: the most likely reason, max 160 characters'},
        'evidence': {'type': 'array', 'items': {'type': 'string'}, 'description': '2 to 5 facts from the material that point to the verdict'},
        'improve': {'type': 'array', 'items': {'type': 'string'},
                    'description': f'Up to 3 concrete changes for next time; empty when the verdict is "{NOT_ON_YOU}"'},
    },
}

SYSTEM = f"""You review one rejected job application for its candidate (the owner of Job Pilotto) and say, honestly \
and kindly, why it most likely failed and whether there's anything they can do better. You get the job posting, \
what was sent (answers, cover letter), the fit analysis made before applying, the timeline, interview reviews if \
there were interviews, the rejection email, and the candidate's profile (CV).

Pick one verdict:
- "Presentation": the candidate had what the role needed, but the CV, answers or cover letter didn't show it \
(missing keywords the posting stresses, experience buried, generic answers, a weak or missing cover letter).
- "Hard skills": a skill, technology, level or amount of experience the role required and the candidate lacks.
- "Soft skills": communication, structure, seniority or culture signals. Only with interview evidence: an \
application rejected before any conversation can never be "Soft skills".
- "{NOT_ON_YOU}": they wanted a different profile and nothing the candidate could reasonably change would help: \
location or country the role is limited to, work permit, a language, a domain or industry background, a level far \
from theirs, an internal hire, the role closed or paused, very many applicants for a narrow profile.
- "Unclear": the material doesn't support any verdict.

How to judge:
- A rejection within about a day, before any call, is usually an automatic or quick screen: location, permit, \
level or a hard requirement. Say which requirement when you can see it.
- Compare the posting's must-haves with the profile. A must-have the profile truly lacks is "Hard skills"; one the \
profile has but the answers or CV didn't show is "Presentation".
- Use interview reviews (weak answers, signals) for rejections after a conversation.
- Several applications to the same company rejected together (other countries of one role) point to the same cause.
- Don't invent facts. When the evidence is thin, say so with confidence "low" (or "Unclear").
- evidence: short facts, citing the posting, the answers or the timeline. improve: concrete and doable (a CV \
bullet to add, a keyword, a story to prepare), never generic advice; empty for "{NOT_ON_YOU}".
The candidate's profile follows.

"""


def _props(row):
    return {name: plain(value) for name, value in row['properties'].items()
            if (value or {}).get('type') not in ('relation', 'rollup', 'formula', 'files')}


def _related(tracker, database_id, row_id):
    if not database_id:
        return []
    rows = tracker.query_database(database_id, {'property': 'Application', 'relation': {'contains': row_id}})
    return [_props(r) for r in rows]


def material(tracker, row, email_text=''):
    """Everything known about one application, as text for the model."""
    props = _props(row)
    record = tracker.read_kit(row['id'], RECORD_HEADING) or {}
    job = record.get('job') or {}
    events = sorted(_related(tracker, EVENTS_DATABASE_ID, row['id']), key=lambda e: e.get('At') or '')
    interviews = _related(tracker, INTERVIEWS_DATABASE_ID, row['id'])
    same_company = [f"- {plain(r['properties'].get('Job'))} ({plain(r['properties'].get('Stage'))})"
                    for r in tracker.query_database(tracker.database_id, {'property': 'Company', 'rich_text': {'equals': props.get('Company') or '-'}})
                    if r['id'] != row['id']] if props.get('Company') else []
    keep = ('Job', 'Company', 'Location', 'Work mode', 'Seniority', 'Salary', 'Channel', 'Via', 'Applied on', 'Fit score',
            'Stage', 'Notes', 'Next step', 'Cover letter', 'Answers captured', 'CV version')
    parts = ['## Application', '\n'.join(f'{k}: {props[k]}' for k in keep if props.get(k))]
    if props.get('Employer feedback'):
        parts += ['## Employer feedback (verbatim, primary evidence)', props['Employer feedback'][:12000]]
    match = record.get('match') or {}
    if match:
        parts += ['## Fit analysis before applying', json.dumps({k: v for k, v in match.items() if v not in (None, '', [])},
                                                                 ensure_ascii=False)[:4000]]
    parts += ['## Job posting', (job.get('description') or '(not kept)')[:MAX_DESCRIPTION]]
    answers = record.get('answers') or []
    if answers:
        parts += ['## Answers sent', '\n\n'.join(f"Q: {a.get('question')}\nA: {a.get('answer') or '—'}" for a in answers[:40])]
    if record.get('cover_letter'):
        parts += ['## Cover letter sent', record['cover_letter'][:4000]]
    if not record:
        parts += ['## Note', 'No application record was kept (applied outside Job Pilotto): the answers and cover letter are unknown.']
    parts += ['## Timeline', '\n'.join(f"- {e.get('At')}: {e.get('Kind')} — {e.get('Note') or ''}"[:300] for e in events) or '(none)']
    if interviews:
        parts += ['## Interview reviews', '\n\n'.join(json.dumps({k: v for k, v in i.items() if v}, ensure_ascii=False)[:3000]
                                                        for i in interviews)]
    if same_company:
        parts += ['## Other applications at this company', '\n'.join(same_company)]
    if email_text:
        parts += ['## Rejection email', email_text[:4000]]
    return '\n\n'.join(parts)


def analyse(client, model, profile, text, stats=None):
    response = client.messages.create(
        model=model, max_tokens=2000,
        system=[{'type': 'text', 'text': SYSTEM + (profile or '(no profile)'), 'cache_control': {'type': 'ephemeral'}}],
        messages=[{'role': 'user', 'content': text}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}},
    )
    cost.add(stats, model, response.usage)
    return json.loads(next(b.text for b in response.content if b.type == 'text')), response.usage


def _block(kind, content, bold=False):
    return {'object': 'block', 'type': kind, kind: {'rich_text': [
        {'type': 'text', 'text': {'content': content[:1900]}, 'annotations': {'bold': bold}}]}}


def blocks(result, model):
    out = [_block('callout', f"{EMOJI[result['verdict']]} {result['verdict']} ({result['confidence']} confidence) · "
                             f"{result['stage_reached']}. {result['summary']}")]
    out[0]['callout']['icon'] = {'type': 'emoji', 'emoji': EMOJI[result['verdict']]}
    out.append(_block('paragraph', 'Evidence', bold=True))
    out += [_block('bulleted_list_item', e) for e in result['evidence'][:6]]
    if result['improve']:
        out.append(_block('paragraph', 'What to improve next time', bold=True))
        out += [_block('to_do', i) for i in result['improve'][:3]]
    else:
        out.append(_block('paragraph', 'Nothing to improve here: they were looking for a different profile.'))
    out.append(_block('paragraph', f'Reviewed by {model}. A best guess from what Job Pilotto kept, not what the company said.'))
    return out


def write(tracker, row, result, model):
    lesson = result['summary'] + (f" Next time: {result['improve'][0]}" if result['improve'] else '')
    try:
        tracker.update_page(row['id'], {'Rejection reason': {'select': {'name': result['verdict']}},
                                        'Rejection lesson': {'rich_text': [{'text': {'content': lesson[:1900]}}]}})
    except Exception as error:  # noqa: BLE001 — columns added at the app's next start; the page section still has it all
        print(f'Warning: rejection columns not set ({type(error).__name__}); the review is on the page.', file=sys.stderr)
    tracker.replace_after_heading(row['id'], HEADING, blocks(result, model))


def line(row, result):
    """One short line for Telegram and the desktop app's activity panel."""
    return (f"{EMOJI[result['verdict']]} Why rejected · {plain(row['properties'].get('Company'))} — "
            f"{plain(row['properties'].get('Job'))[:60]}: {result['verdict']} ({result['confidence']}). {result['summary']}")


def review(tracker, row, *, email_text='', client=None, model=DEFAULT_MODEL, stats=None, profile=None):
    """Review one rejected application and write the result on it. Returns (result, one-line summary)."""
    if client is None:
        from . import engine
        client = engine.client()
    profile = tracker.page_text() if profile is None else profile
    result, _ = analyse(client, model, profile, material(tracker, row, email_text), stats)
    if result['verdict'] not in VERDICTS:
        result['verdict'] = 'Unclear'
    if result['verdict'] == NOT_ON_YOU:
        result['improve'] = []
    write(tracker, row, result, model)
    return result, line(row, result)


def pending(tracker, limit=3):
    """Rejected applications with no review yet. Only where the "Rejection reason" column exists: without it,
    a review couldn't be marked done and would run again at every check."""
    rows = tracker.query_database(tracker.database_id, {'property': 'Stage', 'select': {'equals': 'Rejected'}})
    todo = [r for r in rows if 'Rejection reason' in r['properties'] and not plain(r['properties']['Rejection reason'])]
    return sorted(todo, key=lambda r: plain(r['properties'].get('Applied on')) or '', reverse=True)[:limit]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--job', help='the application\'s Job URL')
    target.add_argument('--pending', action='store_true', help='every Rejected application without a review')
    parser.add_argument('--limit', type=int, default=3)
    parser.add_argument('--send', action='store_true', help='send the result to Telegram')
    args = parser.parse_args(argv)
    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required')
    rows = [tracker.find(args.job)] if args.job else pending(tracker, args.limit)
    if args.job and not rows[0]:
        raise SystemExit(f'No application for {args.job}')
    if not rows:
        print('No rejected application waits for a review.')
        return 0
    stats, profile, lines = {}, tracker.page_text(), []
    cron_runs.auto_begin(tracker)  # the review's ⏱️ Search runs row opens when it starts
    log = cron_runs.new_run('rejection')
    if len(rows) == 1:  # a review of one job: the run links to it (several: about none in particular)
        log['application'] = rows[0]['id']
    log['subject'] = cron_runs.job_subject(rows[0]) if len(rows) == 1 else cron_runs.counted(len(rows), 'application')
    try:
        for row in rows:
            _, summary = review(tracker, row, stats=stats, profile=profile)
            lines.append(summary)
            print(summary)
    finally:  # one ⏰ Cronjob Runs row per review run, like every AI job
        log.update(insight=stats, updates=lines)
        cron_runs.log_run(tracker, log)
    if args.send and lines:
        token, chat_id = telegram.credentials()
        telegram.send('🔎 <b>Why it was rejected</b>\n' + '\n'.join(map(escape, lines)), token, chat_id)
    print(f"Rejection review: {len(lines)} application(s) (${(stats or {}).get('usd', 0.0):.3f})")
    return 0


if __name__ == '__main__':
    sys.exit(main())
