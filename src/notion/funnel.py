#!/usr/bin/env python3
"""Application funnel: how many applications reached each step, the conversion between steps,
and which step to improve. No AI, so it costs nothing.

Written to the "📈 Conversion" section of the 🎯 Pipeline page by the scheduled run (after the
ledger sync), and passed to the daily insight as `funnel`.

Usage:
  python -m src.notion.funnel            # print the funnel
  python -m src.notion.funnel --write    # also update the Pipeline page
"""
import argparse
import os
import sys

from . import client as notion
from .ledger import EVENTS_DATABASE_ID, OUTCOME_STAGES, REPLY, plain

PIPELINE_PAGE_ID = os.getenv('NOTION_PIPELINE_PAGE', '')
HEADING = '📈 Conversion'
PREPARED_STAGES = ('Kit ready', 'Applying')
CLOSED_STAGES = {'Rejected', 'Withdrawn', 'No response'}
# Too few decided applications at a step to call its conversion good or bad.
MIN_DECIDED = 5

# (step, which stages or event kinds count as having reached it, rule-of-thumb conversion from the
# previous step, what to work on when the step converts below that).
STEPS = [
    ('📝 Prepared', None, None, ''),
    ('📨 Applied', set(OUTCOME_STAGES), 0.6,
     'Drafted kits are piling up unsent. Submit the ready kits, or raise the auto-kit fit threshold '
     'so fewer, better jobs get a kit.'),
    # A person answered: a reply, or a screening or later. A rejection alone isn't one (most are automatic emails);
    # one after a reply or a screening still counts through those.
    ('💬 Human reply', {REPLY, 'Screening', 'Interview scheduled', 'Interviewing', 'Offer'}, 0.25,
     'Few humans answer. Targeting and the CV are the levers: apply within 3 days of posting, favour '
     'roles scored 70+, tailor the CV summary to the job, try recruiter platforms and referrals.'),
    ('📞 Screening', {'Screening', 'Interview scheduled', 'Interviewing', 'Offer'}, 0.4,
     'People answer but do not move you to a screening. The CV passes a human but the fit does not: check '
     'seniority, location and language requirements before applying.'),
    # Interview scheduled is also used for a booked screening call, so only Interviewing proves this step.
    ('🧑‍💻 Interviews', {'Interviewing', 'Offer'}, 0.5,
     'Screenings do not turn into interviews. Review the 🎤 Interviews notes: salary and notice-period '
     'answers, the 2-minute pitch, and questions about the team.'),
    ('🏆 Offer', {'Offer'}, 0.25,
     'Interviews do not turn into offers. Use the interview reviews: practise the weakest topics and '
     'ask for feedback after each round.'),
]


def reached(tracker):
    """Per application: the set of stages and event kinds it has reached, and its current Stage."""
    rows = tracker.query_database(tracker.database_id, {'or': [
        {'property': 'Stage', 'select': {'equals': stage}} for stage in OUTCOME_STAGES + PREPARED_STAGES]})
    kinds = {}
    for event in tracker.query_database(EVENTS_DATABASE_ID):
        kind = plain(event['properties'].get('Kind'))
        for link in (event['properties'].get('Application') or {}).get('relation', []):
            kinds.setdefault(link['id'].replace('-', ''), set()).add(kind)
    apps = []
    for row in rows:
        stage = plain(row['properties'].get('Stage'))
        apps.append({'stage': stage, 'seen': kinds.get(row['id'].replace('-', ''), set()) | {stage}})
    return apps


def funnel(apps):
    """One dict per step: reached, conversion from the previous step, waiting (still open there)."""
    steps, previous = [], None
    for index, (name, marks, benchmark, advice) in enumerate(STEPS):
        here = apps if marks is None else [a for a in apps if a['seen'] & marks]
        nxt = STEPS[index + 1][1] if index + 1 < len(STEPS) else None
        # Still open at this step: reached it, not the next one, not closed.
        waiting = [a for a in here if a['stage'] not in CLOSED_STAGES and not (nxt and a['seen'] & nxt)]
        step = {'step': name, 'reached': len(here), 'waiting': len(waiting), 'benchmark': benchmark, 'advice': advice}
        if previous is not None:
            step['from'] = previous['reached']
            step['decided'] = previous['reached'] - previous['waiting']
            step['conversion'] = len(here) / previous['reached'] if previous['reached'] else None
            step['decided_conversion'] = len(here) / step['decided'] if step['decided'] else None
        steps.append(step)
        previous = step
    applied = steps[1]['reached']
    for step in steps[1:]:
        step['of_applied'] = step['reached'] / applied if applied else None
    return steps


def focus(steps):
    """The step to improve: the earliest one below its rule of thumb with enough decided applications."""
    for step in steps[1:]:
        rate = step.get('decided_conversion')
        if rate is not None and step['decided'] >= MIN_DECIDED and rate < step['benchmark']:
            return step
    return None


def pct(value):
    return '—' if value is None else f'{round(value * 100)}%'


def summary(steps):
    """Plain-language lines for the page and the insight prompt."""
    lines = []
    step = focus(steps)
    if step:
        lines.append(f"Improve {step['step']}: {pct(step['decided_conversion'])} of decided applications get here, "
                     f"rule of thumb {pct(step['benchmark'])}. {step['advice']}")
    else:
        lines.append('No step is clearly below its rule of thumb yet.')
    prepared, applied = steps[0], steps[1]
    if prepared['waiting'] >= max(2 * applied['reached'], MIN_DECIDED):
        lines.append(f"Biggest lever now is volume: {prepared['waiting']} kits are drafted but not sent, against "
                     f"{applied['reached']} applications. More applications also make the later steps measurable.")
    small = [s['step'] for s in steps[1:] if s['decided'] < MIN_DECIDED and s['from']]
    if small:
        lines.append(f"Too early to judge {', '.join(small)}: fewer than {MIN_DECIDED} decided applications "
                     'reached the step before it.')
    open_ = [f"{s['waiting']} at {s['step']}" for s in steps[1:-1] if s['waiting']]
    if open_:
        lines.append('Still open: ' + ', '.join(open_) + '.')
    return lines


def _cell(text, bold=False):
    return [{'type': 'text', 'text': {'content': text}, 'annotations': {'bold': bold}}]


def blocks(steps, now_text):
    header = ['Step', 'Reached', 'From previous', 'Of applied', 'Still open here']
    rows = [header] + [[
        s['step'], str(s['reached']),
        '—' if 'from' not in s else f"{pct(s['conversion'])}  ({s['reached']}/{s['from']})",
        pct(s.get('of_applied')) if 'of_applied' in s else '—', str(s['waiting'])] for s in steps]
    table = {'object': 'block', 'type': 'table', 'table': {
        'table_width': len(header), 'has_column_header': True, 'has_row_header': True,
        'children': [{'object': 'block', 'type': 'table_row',
                      'table_row': {'cells': [_cell(c, bold=i == 0) for c in row]}}
                     for i, row in enumerate(rows)]}}
    lines = summary(steps)
    callout = {'object': 'block', 'type': 'callout', 'callout': {
        'icon': {'type': 'emoji', 'emoji': '💡'}, 'color': 'yellow_background',
        'rich_text': _cell('Where to improve\n', bold=True) + _cell('\n'.join(lines))}}
    note = {'object': 'block', 'type': 'paragraph', 'paragraph': {'rich_text': [{
        'type': 'text', 'text': {'content': f'From previous = share of the previous step that got this far. '
                                             f'Rule of thumb is judged on decided applications only (not still '
                                             f'open). Updated {now_text} by the scheduled run.'},
        'annotations': {'italic': True, 'color': 'gray'}}]}}
    return [table, callout, note]


def write(tracker, steps, now_text, page_id=PIPELINE_PAGE_ID):
    tracker.replace_after_heading(page_id, HEADING, blocks(steps, now_text))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--write', action='store_true', help='update the Pipeline page')
    args = parser.parse_args(argv)
    from datetime import datetime
    tracker = notion.Tracker.from_env()
    steps = funnel(reached(tracker))
    for s in steps:
        print(f"{s['step']:<16} {s['reached']:>3}  {pct(s.get('conversion')):>5}  open {s['waiting']}")
    print('\n'.join(summary(steps)))
    if args.write:
        write(tracker, steps, datetime.now().strftime('%d %b %H:%M'))
        print('Pipeline page updated.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
