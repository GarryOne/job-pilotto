#!/usr/bin/env python3
"""Does the model still read the Gmail check's emails right? (the AI half of the check, which its unit tests stub)

Sends tests/fixtures/mail_eval.json (invented emails with a known right answer, one tracked-applications list for all of them) to the
real model through the check's own `mail.classify` and its real prompt, and scores the answers: relevant or not, the kind, and which
application. A model gives a different answer now and then, so the run passes on a share of right answers (SHARE), and fails at once on
a `strict` case wrong: a rejection, an offer or an invitation missed, or a security code, receipt or vendor alert taken for an application.

  python3 tools/mail_eval.py            # needs an Anthropic key in the environment (engine.client); about a cent a run
  python3 tools/mail_eval.py --model claude-haiku-4-5
"""
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
FIXTURE = ROOT / 'tests' / 'fixtures' / 'mail_eval.json'
SHARE = 0.85  # of all cases, the share that must be right; the strict ones must all be right


def load(path=FIXTURE):
    data = json.loads(Path(path).read_text())
    return data['applications'], data['cases']


def judge(case, result, applications):
    """-> '' when the model's answer for this case is right, else why not. result: the model's item (or None)."""
    want = case['expect']
    if result is None:
        return 'no answer'
    if bool(result.get('relevant')) != want['relevant']:
        return f"relevant={result.get('relevant')}, wanted {want['relevant']}"
    if not want['relevant']:
        return ''
    if result.get('kind') not in want['kinds']:
        return f"kind={result.get('kind')}, wanted {' or '.join(want['kinds'])}"
    index = result.get('application', -1)
    if index == -1:
        got = None
    elif 0 <= index < len(applications):
        got = applications[index]['company'] or applications[index].get('via', '')
    else:
        got = f'out of range ({index})'
    if got != want['application']:
        return f"application={got!r}, wanted {want['application']!r}"
    return ''


def score(cases, results, applications):
    """-> {'rows': [(id, strict, why)], 'right': n, 'share': x, 'strict_failed': [ids], 'passed': bool}"""
    rows = [(case['id'], case['strict'], judge(case, results.get(i), applications)) for i, case in enumerate(cases)]
    right = sum(1 for _, _, why in rows if not why)
    strict_failed = [id for id, strict, why in rows if strict and why]
    share = right / len(rows) if rows else 0
    return {'rows': rows, 'right': right, 'share': share, 'strict_failed': strict_failed, 'passed': not strict_failed and share >= SHARE}


def tracked(applications):
    """The check's own application rows (src/ai/mail.py reads these fields from Notion pages)."""
    text = lambda value: {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}
    return [{'id': f'p{n}', 'properties': {
        'Company': text(app['company']), 'Job': {'type': 'title', 'title': [{'plain_text': app['job']}]},
        'Stage': {'type': 'select', 'select': {'name': app['stage']}}, 'Via': text(app.get('via', '')), 'Contact': text(app.get('contact', '')),
        'Applied on': {'type': 'date', 'date': {'start': app['applied']} if app['applied'] else None}, 'Next step': text(''),
        'Next interview': {'type': 'date', 'date': None}, 'Job URL': {'type': 'url', 'url': f'https://x.test/p{n}'}}} for n, app in enumerate(applications)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--model', default=None)
    args = parser.parse_args(argv)
    from src.ai import engine, mail
    applications, cases = load()
    items = [dict(case['email']) for case in cases]
    results = mail.classify(engine.client(action='mail'), args.model or mail.DEFAULT_MODEL, tracked(applications), items)
    report = score(cases, results, applications)
    for id, strict, why in report['rows']:
        print(f"{'ok  ' if not why else 'MISS'} {'[strict] ' if strict else '         '}{id}{': ' + why if why else ''}")
    print(f"\n{report['right']}/{len(cases)} right ({report['share']:.0%}, needs {SHARE:.0%}); strict misses: {report['strict_failed'] or 'none'}")
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
