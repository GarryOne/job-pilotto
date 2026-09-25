#!/usr/bin/env python3
"""Score local browser-run reports against human-checked, unsubmitted ATS forms.

The review file contains field labels and correctness flags only, never applicant values.
Usage: python3 tools/benchmark-apply-runs.py /private/path/reviews.json --min-ats 3
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai.apply_run import STATE_DIR  # noqa: E402
from src.notion.client import job_code  # noqa: E402


def score_case(case, state_dir):
    if case.get('submitted') is not False:
        raise ValueError('benchmark cases must explicitly be unsubmitted')
    url = case['url']
    state = json.loads((state_dir / f'{job_code(url)}.json').read_text())
    report = json.loads((state_dir / f'{job_code(url)}.result.json').read_text())
    if state.get('url') != url:
        raise ValueError('run URL does not match review URL')
    agent = {f['label'].strip().casefold(): f for f in report['fields']}
    human = {f['label'].strip().casefold(): f for f in case['reviewed_fields']}
    if len(human) != len(case['reviewed_fields']) or not human:
        raise ValueError('review must list unique field labels')
    correct = sum(bool(f['correct']) for f in human.values())
    covered = len(human.keys() & agent.keys())
    false_claims = sum(bool(agent[label].get('matches_source')) and not item['correct']
                       for label, item in human.items() if label in agent)
    return {'ats': case['ats'], 'url': url, 'fields': len(human), 'covered': covered,
            'correct': correct, 'false_claims': false_claims,
            'minutes': state.get('minutes'), 'status': state['status']}


def summarize(cases, state_dir, min_ats=3):
    rows = [score_case(case, state_dir) for case in cases]
    ats = {row['ats'].strip().casefold() for row in rows}
    if len(ats) < min_ats:
        raise ValueError(f'need at least {min_ats} distinct ATSs; found {len(ats)}')
    fields = sum(row['fields'] for row in rows)
    return {'cases': len(rows), 'ats': sorted(ats), 'fields': fields,
            'coverage': round(sum(row['covered'] for row in rows) / fields, 3),
            'correctness': round(sum(row['correct'] for row in rows) / fields, 3),
            'false_agent_claims': sum(row['false_claims'] for row in rows),
            'active_minutes': round(sum(row['minutes'] or 0 for row in rows), 2),
            'rows': rows}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reviews', type=Path, help='private JSON file with human field checks')
    parser.add_argument('--state-dir', type=Path, default=STATE_DIR)
    parser.add_argument('--min-ats', type=int, default=3)
    args = parser.parse_args(argv)
    result = summarize(json.loads(args.reviews.read_text())['cases'], args.state_dir, args.min_ats)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
