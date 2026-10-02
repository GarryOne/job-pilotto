#!/usr/bin/env python3
"""What would a cheaper fit-scoring setup cost in QUALITY? Measured, not guessed.

Takes jobs already scored by the main model (the `scores` table of the local jobs database), re-scores a stratified sample
with cheaper variants (the cheap model, lower effort) and compares with the original scores: rank agreement, how often a job
crosses a threshold the app acts on (digest 50, auto-kit 50, "good fit" 70 ...), and, for a cheap-first-pass cascade, how many of
the jobs the main model rated high the cheap pass would have let through at each escalation bar, and what that costs.

  python3 tools/score_eval.py --estimate                    # what the run would cost, no API call
  python3 tools/score_eval.py --yes --sample 60 --out eval.json
It spends API money (a few dollars at most) and only runs with --yes. It changes nothing in the database.
"""
import argparse
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

THRESHOLDS = (50, 60, 70, 80)
BARS = (30, 35, 40, 45, 50, 55, 60)
HAIKU, SONNET = 'claude-haiku-4-5', 'claude-sonnet-5'
VARIANTS = {'haiku': (HAIKU, None), 'sonnet-low': (SONNET, 'low'), 'repeat': (SONNET, None)}   # repeat = the main setup again: the noise floor


def ranks(values):
    """Average ranks (ties share), 1-based."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return out


def spearman(xs, ys):
    """Rank correlation, -1..1 (None when it cannot be computed)."""
    if len(xs) != len(ys) or len(xs) < 3:
        return None
    rx, ry = ranks(xs), ranks(ys)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else None


def stratified_sample(rows, n, seed=1):
    """About n rows spread over the score bands the app acts on, so the sample is not all low scores."""
    bands = {}
    for row in rows:
        score = row['base']
        bands.setdefault(0 if score < 40 else 1 if score < 60 else 2 if score < 80 else 3, []).append(row)
    rng = random.Random(seed)
    per = max(1, n // max(1, len(bands)))
    picked = []
    for band in sorted(bands):
        group = bands[band][:]
        rng.shuffle(group)
        picked += group[:per]
    rest = [row for band in bands.values() for row in band if row not in picked]
    rng.shuffle(rest)
    return (picked + rest)[:n]


def compare(base, other):
    """How a variant's scores differ from the original ones."""
    n = len(base)
    diffs = [o - b for b, o in zip(base, other)]
    return {'n': n, 'spearman': spearman(base, other), 'mean_abs_diff': sum(abs(d) for d in diffs) / n if n else None,
            'bias': sum(diffs) / n if n else None,
            'flips': {str(t): sum((b >= t) != (o >= t) for b, o in zip(base, other)) / n if n else None for t in THRESHOLDS}}


def cascade(base, cheap, cost_cheap, cost_main):
    """For each escalation bar: the share sent on to the main model, how many of the jobs it rated >= B the cheap pass let through,
    and the cost against scoring everything with the main model."""
    n = len(base)
    table = []
    for bar in BARS:
        sent = [c >= bar for c in cheap]
        row = {'bar': bar, 'escalated': sum(sent) / n if n else None,
               'cost_vs_main': (cost_cheap + (sum(sent) / n) * cost_main) / cost_main if n and cost_main else None}
        for high in THRESHOLDS:
            wanted = [s for b, s in zip(base, sent) if b >= high]
            row[f'kept_{high}'] = sum(wanted) / len(wanted) if wanted else None
        table.append(row)
    return table


def estimate(n, variants):
    """A rough cost before spending anything: ~4k tokens in and ~1k out per Sonnet call, ~700 out for Haiku (list prices)."""
    prices = {HAIKU: (1, 5), SONNET: (2, 10)}
    total = 0.0
    for name in variants:
        model, _ = VARIANTS[name]
        count = max(3, n // 3) if name == 'repeat' else n
        price_in, price_out = prices[model]
        total += count * (4000 * price_in + (700 if model == HAIKU else 1000) * price_out) / 1e6
    return total


def load_scored(db):
    from src import digest
    from src.ai import score as score_module
    score_module.db_ready = True
    candidates, _ = digest.eligible_jobs(db)
    done = {}
    for row in db.execute('SELECT job_id, data_json FROM scores'):
        try:
            done[row['job_id']] = int(json.loads(row['data_json'])['score'])
        except (ValueError, KeyError, TypeError):
            continue
    return [dict(job, base=done[job['id']]) for job in candidates if job['id'] in done and job.get('description')]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--sample', type=int, default=60)
    parser.add_argument('--variants', default='haiku,sonnet-low,repeat')
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--out')
    parser.add_argument('--estimate', action='store_true', help='print the expected cost and stop')
    parser.add_argument('--yes', action='store_true', help='really call the API')
    args = parser.parse_args(argv)
    names = [name.strip() for name in args.variants.split(',') if name.strip()]
    unknown = [name for name in names if name not in VARIANTS]
    if unknown:
        parser.error(f'unknown variant(s): {", ".join(unknown)} (known: {", ".join(VARIANTS)})')
    print(f'Expected cost for {args.sample} jobs and {", ".join(names)}: about ${estimate(args.sample, names):.2f}')
    if args.estimate or not args.yes:
        print('Nothing was called. Add --yes to run it.')
        return 0
    from src import store
    from src.ai import cost, engine, score
    from src.paths import JOBS_DB, local_profile
    from src import notion
    with store.connect(JOBS_DB) as db:
        rows = load_scored(db)
    if len(rows) < 12:
        print(f'Only {len(rows)} scored job(s) here: too few to compare.')
        return 1
    sample = stratified_sample(rows, args.sample, args.seed)
    profile = score.scoring_profile(local_profile() or notion.Tracker.from_env().page_text())
    client = engine.client()
    report = {'sample': len(sample), 'base_scores': [row['base'] for row in sample], 'variants': {}}
    for name in names:
        model, effort = VARIANTS[name]
        subset = sample[:max(3, len(sample) // 3)] if name == 'repeat' else sample
        stats, scores = {}, []
        for job in subset:
            data, usage = score.score_one(client, model, job, profile, effort=effort)
            cost.add(stats, model, usage)
            scores.append(data['score'])
        base = [row['base'] for row in subset]
        entry = {'model': model, 'effort': effort or score.EFFORT, 'jobs': len(subset), 'usd': stats.get('usd', 0.0),
                 'usd_per_job': stats.get('usd', 0.0) / len(subset), 'compare': compare(base, scores), 'scores': scores}
        report['variants'][name] = entry
        c = entry['compare']
        print(f"{name:<11} {model} {entry['effort']}: ${entry['usd_per_job']:.4f}/job, rank corr {c['spearman'] and round(c['spearman'], 2)}, "
              f"mean abs diff {round(c['mean_abs_diff'], 1)}, bias {round(c['bias'], 1)}, flips " + ' '.join(f'{t}:{round(v * 100)}%' for t, v in c['flips'].items()))
    if 'haiku' in report['variants']:
        main_cost = (report['variants'].get('repeat') or report['variants'].get('sonnet-low') or {}).get('usd_per_job')
        if main_cost:
            report['cascade'] = cascade(report['base_scores'], report['variants']['haiku']['scores'], report['variants']['haiku']['usd_per_job'], main_cost)
            print('\nCascade (cheap pass first; only jobs at or above the bar go to the main model):')
            print('bar  sent   cost vs main   of the jobs the main model rated >=50 / 60 / 70 / 80, the share the cheap pass lets through')
            for row in report['cascade']:
                kept = ' / '.join('-' if row[f'kept_{t}'] is None else f"{round(row[f'kept_{t}'] * 100)}%" for t in THRESHOLDS)
                print(f"{row['bar']:>3}  {round(row['escalated'] * 100):>3}%   {round(row['cost_vs_main'] * 100):>3}%           {kept}")
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
