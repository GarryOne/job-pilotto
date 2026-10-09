#!/usr/bin/env python3
"""Application funnel: how many applications reached each step, the conversion between steps,
and which step to improve. No AI, so it costs nothing.

Read from the active store (src/stores). With Notion, written to the "📈 Conversion" section of the 🎯 Pipeline page
by the scheduled run (after the ledger sync); other stores have no such page (the app's Focus draws the funnel from
the same numbers, src/focus_state.py). Passed to the daily insight as `funnel`. Guarded by tests/test_funnel.py.

Usage:
  python -m src.notion.funnel            # print the funnel
  python -m src.notion.funnel --write    # also update the Pipeline page (Notion only)
"""
import argparse
import os
import sys

from .ledger import OUTCOME_STAGES, REPLY
from .origin import INBOUND, origin as origin_of, row_origin as _row_origin

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


def row_origin(row, kinds=()):
    """'inbound' or 'outbound' for an Applications row (src/notion/origin.py): its Origin column, else derived."""
    return _row_origin(row, kinds)


# The inbound funnel (Focus): the outbound funnel's own step sets, so "screening" means the same on both.
INBOUND_STEPS = [('📥 Contacted you', None), ('📞 Screening', STEPS[3][1]), ('🧑‍💻 Interviews', STEPS[4][1]),
                 ('🏆 Offers', STEPS[5][1])]


def inbound_counts(apps):
    """Opportunities that found you: how many contacted you, and how many of them reached a screening, interviews
    and an offer (ever reached, like the outbound funnel)."""
    reached = [sum(1 for a in apps if marks is None or a['seen'] & marks) for _, marks in INBOUND_STEPS]
    return dict(zip(('contacted', 'screening', 'interviews', 'offers'), reached))


def inbound_funnel(apps):
    """One dict per inbound step: how many ever reached it, their share of those who contacted you, and their links
    (apps: {'seen', 'url'}) for the Jobs list a click shows."""
    contacted = len(apps)
    steps = []
    for name, marks in INBOUND_STEPS:
        here = [a for a in apps if marks is None or a['seen'] & marks]
        steps.append({'step': name, 'reached': len(here), 'of_contacted': len(here) / contacted if contacted else None,
                      'urls': [a['url'] for a in here if a.get('url')]})
    return steps


def _stores(stores_or_tracker):
    """The store: given, or the notion store around a caller's Notion tracker (callers that still hold one)."""
    from ..stores import Stores, open_stores
    return stores_or_tracker if isinstance(stores_or_tracker, Stores) else open_stores(tracker=stores_or_tracker)


def _key(record_id):
    return (record_id or '').replace('-', '')


def reached(stores):
    """Per outbound application (src/notion/origin.py): the set of stages and event kinds it has reached, and its
    current stage. Opportunities that found you (inbound) are not in the funnel. stores: the store (or a Notion
    tracker)."""
    stores = _stores(stores)
    rows = stores.applications.list(stages=list(OUTCOME_STAGES + PREPARED_STAGES))
    kinds = {}  # oldest first: the first contact decides inbound or outbound
    for event in sorted(stores.events.list(), key=lambda event: event.get('at') or ''):
        kinds.setdefault(_key(event.get('app_id')), []).append(event.get('kind') or '')
    apps = []
    for row in rows:
        stage, ordered = row.get('stage') or '', kinds.get(_key(row['id']), [])
        if origin_of(source=row.get('source') or '', stage=stage, notes=row.get('notes') or '', kinds=ordered,
                     origin=row.get('origin') or '') == INBOUND:
            continue
        apps.append({'stage': stage, 'seen': set(ordered) | {stage}})
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


def pipeline_tracker(stores):
    """The Notion client that writes the 🎯 Pipeline page, or None: only a Notion store with a Pipeline page has one."""
    tracker = getattr(stores.applications, 'tracker', None)
    return tracker if tracker is not None and PIPELINE_PAGE_ID else None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--write', action='store_true', help='update the Pipeline page')
    args = parser.parse_args(argv)
    from datetime import datetime
    from ..stores import open_stores
    stores = open_stores()
    steps = funnel(reached(stores))
    for s in steps:
        print(f"{s['step']:<16} {s['reached']:>3}  {pct(s.get('conversion')):>5}  open {s['waiting']}")
    print('\n'.join(summary(steps)))
    if args.write:
        tracker = pipeline_tracker(stores)
        if tracker is None:
            print('No Pipeline page with this store: the app shows the funnel on Focus.')
        else:
            write(tracker, steps, datetime.now().strftime('%d %b %H:%M'))
            print('Pipeline page updated.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
