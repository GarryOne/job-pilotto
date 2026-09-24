#!/usr/bin/env python3
"""AI stage 2: score how well each job fits the owner's Profile.

Runs after stage 1 and the hard filters, so only jobs the owner could apply to
are scored. The Profile page in Notion is the rubric's input; editing it
re-scores every open job on the next run. Scores are advisory: they order the
digest and never apply to anything.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import os

import job_store

# Bump when the prompt or schema changes so every job is re-scored once.
SCORER_VERSION = 1
DEFAULT_MODEL = os.getenv('SRE_WATCH_SCORE_MODEL', 'claude-sonnet-5')

SCORES_TABLE = """
CREATE TABLE IF NOT EXISTS scores (
    job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
    scorer_version INTEGER NOT NULL,
    input_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data_json TEXT NOT NULL
);
"""

_component = {'type': 'integer', 'description': '0-100'}
SCHEMA = {
    'type': 'object',
    'additionalProperties': False,
    'required': ['score', 'tier', 'components', 'reason', 'strengths', 'gaps', 'confidence'],
    'properties': {
        'score': {'type': 'integer', 'description': 'Overall fit 0-100'},
        'tier': {'type': 'string', 'enum': ['A', 'B', 'C'],
                 'description': 'A = pursue (tailored application, look for a referral); B = apply; C = skip'},
        'components': {
            'type': 'object', 'additionalProperties': False,
            'required': ['role_fit', 'location', 'compensation', 'growth', 'risk'],
            'properties': {
                'role_fit': _component, 'location': _component, 'compensation': _component,
                'growth': _component,
                'risk': {'type': 'integer', 'description': '0-100, higher = more risk or uncertainty'},
            },
        },
        'reason': {'type': 'string', 'description': 'One line, at most 90 characters, why it fits or not'},
        'strengths': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 3 short, specific matches'},
        'gaps': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Up to 3 short gaps or unknowns'},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
}

SYSTEM = """You rank job postings for one candidate. The candidate's profile follows. \
Score each posting for fit, using only the profile and the posting.

Rules:
- Role fit compares the posting's responsibilities and required skills with the candidate's real \
experience. Name concrete matches (e.g. "Datadog + Terraform monitoring"), not generic praise.
- Location covers Swiss work eligibility, commute from the home base, remote policy and workload.
- Compensation: compare only an advertised salary with the target. If no salary is stated, give 50 \
and list it as a gap. Never invent a figure or a net amount.
- Growth covers scope, technical depth and seniority relative to the candidate's level.
- Risk rises for recruiter listings, vague employers, junior or unrelated roles, heavy on-call, \
missing information.
- Missing information lowers confidence; it is not evidence against the job.
- Do not reward a famous brand by itself.
- Tier A: strong fit worth a tailored application. Tier B: reasonable fit. Tier C: poor fit.
- reason: one line under 90 characters, plain words, no hype.

Candidate profile:
"""


def input_hash(job, facts, profile):
    blob = json.dumps({'title': job['title'], 'description': job.get('description') or '',
                       'facts': facts, 'profile': profile}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


def pending_jobs(db, candidates, profile, limit):
    """Candidates whose score is missing or out of date (job, facts or profile changed)."""
    db.executescript(SCORES_TABLE)
    done = {row['job_id']: row for row in db.execute('SELECT job_id, scorer_version, input_hash FROM scores')}
    pending = []
    for job in candidates:
        if not job.get('description'):
            continue
        row = done.get(job['id'])
        if row and row['scorer_version'] == SCORER_VERSION and row['input_hash'] == input_hash(job, job.get('ai'), profile):
            continue
        pending.append(job)
    return sorted(pending, key=lambda j: j['first_seen_at'], reverse=True)[:limit]


def score_one(client, model, job, profile):
    facts = json.dumps(job.get('ai') or {}, ensure_ascii=False)
    params = dict(
        model=model,
        max_tokens=4000,
        # The profile is identical for every job, so it is cached across requests.
        system=[{'type': 'text', 'text': SYSTEM + profile, 'cache_control': {'type': 'ephemeral'}}],
        messages=[{'role': 'user', 'content': (
            f"Title: {job['title']}\nCompany: {job['company']}\nLocation: {job.get('location') or ''}\n"
            f"Extracted facts (stage 1): {facts}\n\nPosting:\n{job['description']}")}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}, 'effort': 'medium'},
    )
    response = client.messages.create(**params)
    if response.stop_reason != 'end_turn':
        raise RuntimeError(f'stopped with {response.stop_reason}')
    data = json.loads(next(block.text for block in response.content if block.type == 'text'))
    clamp = lambda n: max(0, min(100, int(n)))
    data['score'] = clamp(data['score'])
    data['components'] = {k: clamp(v) for k, v in data['components'].items()}
    data['strengths'], data['gaps'] = data['strengths'][:3], data['gaps'][:3]
    return data, response.usage


def save(db, job, model, data, profile):
    db.executescript(SCORES_TABLE)
    db.execute("""INSERT INTO scores (job_id, scorer_version, input_hash, model, created_at, data_json)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET scorer_version=excluded.scorer_version,
        input_hash=excluded.input_hash, model=excluded.model, created_at=excluded.created_at,
        data_json=excluded.data_json""",
               (job['id'], SCORER_VERSION, input_hash(job, job.get('ai'), profile), model,
                datetime.now(timezone.utc).isoformat(timespec='seconds'), json.dumps(data, ensure_ascii=False)))
    db.commit()


def load(db):
    """Map job_id -> score data, for the digest."""
    db.executescript(SCORES_TABLE)
    return {row['job_id']: json.loads(row['data_json']) for row in db.execute('SELECT job_id, data_json FROM scores')}


def run(db, candidates, profile, model, max_jobs, client=None, workers=5):
    """Score up to max_jobs pending candidates; returns a one-line summary."""
    jobs = pending_jobs(db, candidates, profile, max_jobs)
    if not jobs:
        return f'0 job(s) to score with {model}'
    try:
        import anthropic
        transient = (anthropic.APIConnectionError, anthropic.RateLimitError, anthropic.InternalServerError)
        permanent = (anthropic.APIStatusError,)
    except ImportError:
        if client is None:
            raise
        transient = permanent = ()
    client = client or anthropic.Anthropic()
    scored = failures = 0
    usage_totals = {'input': 0, 'output': 0, 'cache_read': 0}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(score_one, client, model, job, profile): job for job in jobs}
        for future in as_completed(futures):
            job = futures[future]
            try:
                data, usage = future.result()
            except transient as error:
                print(f'Stopping early, API unavailable: {type(error).__name__}')
                for pending in futures:
                    pending.cancel()
                break
            except (*permanent, RuntimeError, json.JSONDecodeError, StopIteration, KeyError, ValueError) as error:
                failures += 1
                print(f'Skipped job {job["id"]}: {type(error).__name__}: {error}')
                continue
            save(db, job, model, data, profile)
            scored += 1
            usage_totals['input'] += usage.input_tokens
            usage_totals['output'] += usage.output_tokens
            usage_totals['cache_read'] += getattr(usage, 'cache_read_input_tokens', 0) or 0
    return (f'Scored {scored} of {len(jobs)} job(s) with {model}; {failures} failed; tokens in '
            f"{usage_totals['input']} (+{usage_totals['cache_read']} cached), out {usage_totals['output']}")
