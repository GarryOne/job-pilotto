"""Builds the Free AI quality cases (tools/free-ai-eval.mjs) from FICTIONAL postings: the app's own scoring request (src/ai/score.py), so the prompt is never copied.
Usage: python3 tools/free-ai-cases.py --jobs <jobs.json> --profile <profile.md> --out <cases.json>   (jobs: a list of {id, title, company, location, description, claudeScore?}).
Never point it at the owner's real jobs or profile: they would go to a third party (Cloudflare) in the evaluation; that needs the owner's yes."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import score  # noqa: E402


def cases(jobs, profile):
    out = []
    for job in jobs:
        facts = json.dumps(job.get('ai') or {}, ensure_ascii=False)
        out.append({
            'id': str(job['id']), 'action': 'score', 'baseline': job.get('claudeScore'),
            'params': {'max_tokens': 4000, 'system': [{'type': 'text', 'text': score.SYSTEM + profile}],
                       'messages': [{'role': 'user', 'content': (
                           f"Title: {job['title']}\nCompany: {job['company']}\nLocation: {job.get('location') or ''}\n"
                           f"Extracted facts (stage 1): {facts}\n\nPosting:\n{job['description']}\n\n[case {job['id']}]")}],
                       'output_config': {'format': {'type': 'json_schema', 'schema': score.SCHEMA}}}})
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--jobs', required=True)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    Path(args.out).write_text(json.dumps(cases(json.loads(Path(args.jobs).read_text()), Path(args.profile).read_text()), ensure_ascii=False))
