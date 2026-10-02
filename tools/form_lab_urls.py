"""Public application-form URLs for the form lab (tools/form-lab.mjs), aimed where users actually are.

    python3 tools/form_lab_urls.py [--feeds 25] [--seed 7] [--plan plan.json]  > urls.txt

--plan is the site's GET /api/lab/plan (owner key): which job boards users fill most, and which controls fail, are untested or
have a candidate recipe, with the public pages where they were seen. The budget is split:
  up to 60%  the head: pages where the failing, unproven or candidate-recipe controls were seen (revisited every day);
  15%        exploration: any feed on any board, so new kinds of form are found;
  the rest   by demand: a feed on a board chosen in proportion to how many forms users fill there (what the head leaves unused too).
Without a plan (no users yet) boards are chosen by a rough market-share prior. A feed that fails is skipped; a control used by
almost no one gets only its chance in the exploration share."""
import argparse
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SYSTEMS = ('greenhouse', 'ashby', 'lever')
SHARES = {'head': 0.60, 'explore': 0.15}   # the rest is demand
PRIOR = {'greenhouse': 40, 'ashby': 15, 'lever': 15}


def pick_url(feeds, rng, jobs_of, tried):
    """One open job's URL from a feed of `feeds` (shuffled), skipping dead feeds and feeds already used."""
    pool = [f for f in feeds if (f['ats'], f['slug']) not in tried]
    rng.shuffle(pool)
    for feed in pool:
        tried.add((feed['ats'], feed['slug']))
        url = jobs_of(feed)
        if url:
            return url
    return None


def allocate(feeds, plan, count, rng, jobs_of):
    """The URLs to visit: head (revisits), demand-weighted, exploration. `jobs_of(feed)` gives one open job's URL or None."""
    chosen, tried = [], set()

    def add(url):
        if url and url not in chosen and len(chosen) < count:
            chosen.append(url)

    for item in (plan or {}).get('head', []):                       # the head: pages where it matters, up to its share
        for url in item.get('urls', []):
            if len(chosen) < math.ceil(SHARES['head'] * count):
                add(url)
    by_system = {system: [f for f in feeds if f.get('ats') == system] for system in SYSTEMS}
    weights = {b['board']: b['weight'] for b in (plan or {}).get('boards', []) if b.get('board') in SYSTEMS and b.get('weight', 0) > 0} or dict(PRIOR)
    # Exploration is a fixed small share; whatever the head does not use goes to demand, not to chance.
    explore = min(math.ceil(SHARES['explore'] * count), count - len(chosen))
    while len(chosen) < count - explore:
        before = len(chosen)
        system = rng.choices(list(weights), weights=list(weights.values()))[0]
        add(pick_url(by_system.get(system, []), rng, jobs_of, tried))
        if len(chosen) == before and not any((f['ats'], f['slug']) not in tried for f in by_system.get(system, [])) and all(
                not any((f['ats'], f['slug']) not in tried for f in by_system.get(name, [])) for name in weights):
            break
    while len(chosen) < count:                                           # exploration: any feed on any board
        before = len(chosen)
        add(pick_url([f for fs in by_system.values() for f in fs], rng, jobs_of, tried))
        if len(chosen) == before and not [f for fs in by_system.values() for f in fs if (f['ats'], f['slug']) not in tried]:
            break
    return chosen


def main():
    from src import employer_index  # noqa: E402
    from src.sources import ats  # noqa: E402
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--feeds', type=int, default=25)
    parser.add_argument('--seed', type=int, default=None)
    parser.add_argument('--plan', default='')
    options = parser.parse_args()
    plan = {}
    if options.plan:
        try:
            plan = json.loads(Path(options.plan).read_text())
        except (OSError, ValueError):
            print('no usable plan: using the prior', file=sys.stderr)

    def jobs_of(feed):
        try:
            jobs = [job for job in ats.fetch(feed['ats'], feed['slug']) if job.get('url')]
        except Exception as error:  # noqa: BLE001 — one dead feed must not stop the list
            print(f"skipped {feed['ats']}:{feed['slug']}: {type(error).__name__}", file=sys.stderr)
            return None
        return random.choice(jobs)['url'] if jobs else None

    feeds = [f for f in employer_index.load() if f.get('ats') in SYSTEMS]
    for url in allocate(feeds, plan, options.feeds, random.Random(options.seed), jobs_of):
        print(url)


if __name__ == '__main__':
    main()
