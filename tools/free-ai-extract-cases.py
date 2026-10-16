"""Builds the Free AI extraction cases (tools/free-ai-eval.mjs): the app's own extraction request (src/ai/enrich.py) over the invented postings, each with the facts its text states.
Usage: python3 tools/free-ai-extract-cases.py --jobs tools/free-ai-eval-jobs.json --out <cases.json>   (fictional postings only: the cases go to a third party)."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import enrich  # noqa: E402

HYBRID, ONSITE, REMOTE = {'work_mode.value': ['hybrid']}, {'work_mode.value': ['onsite']}, {'work_mode.value': ['remote']}
PAID, UNPAID = {'salary.stated': [True]}, {'salary.stated': [False]}


def lang(language, level='required'):
    return {'languages': [{'language': language, 'level': level}]}


# What each invented posting's own text states (id -> expected paths / list entries). Only what the text says outright.
TRUTH = {
    'fx-01': ({**HYBRID, **PAID, 'seniority.value': ['senior']}, {}),
    'fx-02': ({**HYBRID, **PAID}, {}),
    'fx-03': ({**HYBRID, **PAID, 'seniority.value': ['staff_principal']}, {}),
    'fx-04': ({**HYBRID, **PAID}, lang('German', 'nice_to_have')),
    'fx-05': ({**REMOTE, **PAID, 'seniority.value': ['senior']}, {}),
    'fx-06': ({**HYBRID, **PAID, 'seniority.value': ['staff_principal']}, {}),
    'fx-09': ({**HYBRID, **PAID, 'seniority.value': ['lead_manager']}, {}),
    'fx-11': ({**HYBRID, **PAID, 'seniority.value': ['mid']}, {}),
    'fx-12': ({'work_mode.value': ['onsite', 'hybrid'], **PAID}, {}),
    'fx-13': ({**REMOTE, **PAID}, lang('French')),
    'fx-14': ({**HYBRID, **PAID}, {}),
    'fx-17': ({**HYBRID, **PAID}, lang('German')),
    'fx-19': ({**HYBRID, **PAID, 'seniority.value': ['junior']}, lang('Italian')),
    'fx-20': ({**ONSITE, **PAID}, lang('German')),
    'fx-21': ({**ONSITE, **UNPAID}, lang('German')),
    'fx-30': ({**ONSITE, **UNPAID}, lang('German')),
}


def cases(jobs):
    out = []
    for job in jobs:
        if job['id'] not in TRUTH:
            continue
        paths, has = TRUTH[job['id']]
        out.append({
            'id': job['id'], 'action': 'extract', 'expect': {'paths': paths, **({'has': has} if has else {})},
            'params': {'max_tokens': 2000, 'system': enrich.SYSTEM,
                       'messages': [{'role': 'user', 'content': f"Title: {job['title']}\nCompany: {job['company']}\nLocation: {job.get('location') or ''}\n\nPosting:\n{job['description']}"}],
                       'output_config': {'format': {'type': 'json_schema', 'schema': enrich.SCHEMA}}}})
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--jobs', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    Path(args.out).write_text(json.dumps(cases(json.loads(Path(args.jobs).read_text())), ensure_ascii=False))
