"""Public application-form URLs for the form lab (tools/form-lab.mjs): one open job from each of N feeds in the employer index.

    python3 tools/form_lab_urls.py [--feeds 25] [--seed 7]  > urls.txt

Only job boards whose forms the lab knows (greenhouse, ashby, lever); only public pages. Feeds are picked at random, so over
days the lab covers the whole index. A feed that fails is skipped."""
import argparse
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src import employer_index  # noqa: E402
from src.sources import ats  # noqa: E402

SYSTEMS = ('greenhouse', 'ashby', 'lever')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--feeds', type=int, default=25)
    parser.add_argument('--seed', type=int, default=None)
    options = parser.parse_args()
    rng = random.Random(options.seed)
    feeds = [f for f in employer_index.load() if f.get('ats') in SYSTEMS]
    rng.shuffle(feeds)
    found = 0
    for feed in feeds:
        if found >= options.feeds:
            break
        try:
            jobs = ats.fetch(feed['ats'], feed['slug'])
        except Exception as error:  # noqa: BLE001 — one dead feed must not stop the list
            print(f"skipped {feed['ats']}:{feed['slug']}: {type(error).__name__}", file=sys.stderr)
            continue
        jobs = [job for job in jobs if job.get('url')]
        if jobs:
            print(rng.choice(jobs)['url'])
            found += 1


if __name__ == '__main__':
    main()
