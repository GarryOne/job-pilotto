#!/usr/bin/env python3
"""Weekly live check of the scout: can it still find a job feed for each site in config/scout_canary.json?

Real career sites change their pages; the unit tests and the fixture end-to-end cannot see that. This reads the fixed list the way the
scout does (rules only: no AI, no browser) and exits 1 when fewer than min_found still give a feed, listing which ones stopped.
    python3 tools/scout_canary.py            # prints the table, exit 0/1
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('JOB_PILOTTO_FOLLOW_APP', '0')
os.environ.setdefault('JOB_PILOTTO_RENDER', '0')

from src import scout  # noqa: E402
from src.sources import careers  # noqa: E402


def check(site):
    try:
        found = scout.find_feed({'name': site['name'], 'website': site['website']})
    except Exception as error:  # noqa: BLE001 — a crash is a failed site, not a failed tool
        return site['name'], f'error: {type(error).__name__}'
    return site['name'], (f'{found[0]} ({len(found[2])} jobs)' if found else None)


def main():
    careers.READER = careers.RENDER = None   # the same on every machine
    config = json.loads((ROOT / 'config' / 'scout_canary.json').read_text())
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(check, config['sites']))
    ok = [(name, how) for name, how in results if how and not how.startswith('error')]
    print(f'{len(ok)} of {len(results)} sites still give a feed (needed: {config["min_found"]})')
    for name, how in results:
        print(f'  {"ok  " if how and not how.startswith("error") else "LOST"} {name}: {how or "no feed found"}')
    return 0 if len(ok) >= config['min_found'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
