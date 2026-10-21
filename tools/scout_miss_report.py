#!/usr/bin/env python3
"""Why employers of a kind of role have no readable job feed: reads N public employer sites per kind and country (names from Wikidata's own
classes, src/scout_candidates.INDUSTRIES) with the scout's page reader, rules only (no AI; the browser only with --render), and counts where each one stopped.
$0, public pages only, the usual pace per site, a refusal is an answer and is not retried (owner, 20 Oct 2026, sketch decision 3).
  python3 tools/scout_miss_report.py --kind healthcare --country DE --sites 40 --out <folder>
Writes <folder>/<kind>-<country>.json (one row per site: host, bucket, pages read) and prints the bucket counts. Tests: tests/test_scout_miss_report.py."""
import argparse
import json
import re
import sys
import threading
import urllib.parse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src import scout_candidates  # noqa: E402
from src.sources import careers, host_pace  # noqa: E402

SEEN = threading.local()   # per site (one thread each): the job titles the reader found and judged "not job titles"
TEXT_FLOOR = 1500   # a home page with less readable text than this is a shell: its content appears after scripts run


def readable_text(markup):
    """The visible words of a page, roughly: what is left once scripts, styles and tags are gone."""
    return re.sub(r'\s+', ' ', re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>', ' ', markup, flags=re.S | re.I)).strip()


def bucket(found, trace, home):
    """Where a site stopped: one fixed word (the sketch's list of why names do not become feeds)."""
    if found and found.get('empty'):
        return 'page_without_open_jobs'
    if found:
        return 'job_system_embedded' if found.get('ats') != 'careers' else 'jobs_on_the_page'
    first = trace.get('home')
    if first is None:
        return 'not_an_own_site'
    if isinstance(first, Exception):
        code = getattr(first, 'code', None)
        return 'refused' if code in host_pace.REFUSED or type(first).__name__ == 'Refused' else 'unreachable'
    if getattr(SEEN, 'rejected', None):
        return 'jobs_rejected_as_menu_entries'
    if len(readable_text(home or '')) < TEXT_FLOOR:
        return 'home_is_a_script_shell'
    return 'no_careers_link' if trace['pages'] <= 1 else 'pages_read_no_jobs'


def check(website, render=False):
    """One site: its bucket and how many pages answered. With render, a site that gave no feed is read once more with the headless browser
    allowed (the central scout's setting) and, when that finds jobs, is named 'found_only_with_browser'."""
    trace = {'pages': 0, 'hosts': set()}
    home = []
    SEEN.rejected = []

    def fetch_page(url):
        try:
            page = careers.get_text(url)
            trace['pages'] += 1
            trace['hosts'].add((urllib.parse.urlsplit(url).hostname or '').lower().removeprefix('www.'))   # pages that answered: the reader also tries the usual addresses, which mostly do not exist
        except Exception as error:  # noqa: BLE001 — the first page's failure is the answer; later ones are just missing pages
            if 'home' not in trace:
                trace['home'] = error
            raise
        if 'home' not in trace:
            trace['home'] = True
            home.append(page)
        return page
    try:
        found = careers.discover(website, fetch_page)
    except Exception as error:  # noqa: BLE001
        found, trace['home'] = None, trace.get('home') or error
    named = bucket(found, trace, home[0] if home else '')
    if render and named not in ('job_system_embedded', 'jobs_on_the_page', 'refused', 'unreachable', 'not_an_own_site'):
        try:
            again = careers.discover(website)
        except Exception:  # noqa: BLE001 — the browser failing leaves the first answer
            again = None
        if again and not again.get('empty'):
            named = 'found_only_with_browser'
    return {'host': urllib.parse.urlsplit(website if '//' in website else f'https://{website}').hostname, 'bucket': named,
            'pages': trace['pages'], 'hosts': sorted(trace['hosts']), **({'titles': SEEN.rejected} if SEEN.rejected else {})}


def watch_plausible():
    """Wrap the reader's "are these job titles?" judgement so a site whose jobs it read but threw away shows as such."""
    judge = careers._plausible
    if getattr(judge, 'watched', False):
        return

    def watched(jobs):
        ok = judge(jobs)
        if not ok and jobs:
            SEEN.rejected = [job['title'] for job in jobs][:5]
        return ok
    watched.watched = True
    careers._plausible = watched


def sites(kind, country, count, cache):
    """Up to `count` (name, website) of this kind's Wikidata classes in this country, one per website."""
    seen, out = set(), []
    for of in scout_candidates.INDUSTRIES[kind]:
        rows = scout_candidates.wikidata_rows(cache=Path(cache) / f'{of}-{country}.json', query=scout_candidates.wikidata_query(country, staffed=False, of=of))
        for row in rows:
            site = row['site']['value']
            if site not in seen:
                seen.add(site)
                out.append((row['label']['value'], site))
    return out[:count]


def main(argv=None):
    ask = argparse.ArgumentParser(description=__doc__)
    ask.add_argument('--kind', required=True, choices=sorted(scout_candidates.INDUSTRIES))
    ask.add_argument('--country', required=True, help='ISO code, e.g. DE')
    ask.add_argument('--sites', type=int, default=40)
    ask.add_argument('--render', action='store_true', help='read script-built pages through the headless browser too, as the central scout does (needs playwright)')
    ask.add_argument('--out', required=True, help='a folder for the result and the Wikidata cache')
    args = ask.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    careers.CHOOSER = None   # no AI
    careers.RENDER = 'auto' if args.render else None   # no browser unless asked
    if args.render and not careers.renderer():
        sys.exit('--render needs playwright and its browser (requirements-render.txt)')
    watch_plausible()
    chosen = sites(args.kind, args.country, args.sites, out)
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(lambda item: check(item[1], args.render), chosen))
    (out / f'{args.kind}-{args.country}.json').write_text(json.dumps(rows, indent=1))
    print(args.kind, args.country, dict(Counter(row['bucket'] for row in rows)))


if __name__ == '__main__':
    main()
