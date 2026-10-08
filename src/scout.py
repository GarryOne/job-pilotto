#!/usr/bin/env python3
"""Source scout: grow the list of employer job feeds a few companies per run.

Each run
1. harvests candidate employers (seed list with Tier 1 first, Hacker News "Who is
   hiring?", the open hiring-without-whiteboards list, and employers already seen
   on jobs.ch),
2. probes a small batch of them for a public job feed (Greenhouse, Lever, Ashby,
   Workable, Recruitee, Personio, SmartRecruiters, plus Amazon and Netflix),
3. scores every feed it finds for quality (0-100) against the owner's goals,
4. registers useful feeds (Notion Employers & Sources + local table) so the
   4-hourly crawl includes them, and
5. sends one Telegram summary.

Progress lives in the table scout_candidates, so later runs continue where this
one stopped. Nothing here applies to jobs; it only finds where jobs are posted.
"""

import argparse
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from html import escape
from pathlib import Path
from . import contribute, employer_index, scout_core, store, telegram, tgcard
from .notion import client as notion, cron_runs
from .paths import CONFIG, JOBS_DB, load_search_config
from .sources import ats, careers, feeds  # noqa: F401 -- `feeds` is also reached as scout.feeds by tests
from .scout_candidates import harvest, skipped_origins, starter_list
from .scout_core import DEFAULT_BATCH, IDEAS_PAUSE, RECHECK_DAYS, SEEDS, TABLES, TIER1_MIN_RELEVANT, batch_for, key_for, now, pending_count
from .scout_index import board_stats, build_index, central_stats, dead_ends, fetch_boards, fetch_contributions, market_coverage, publish_index, publish_summary, record_unread, run_headline
from .scout_notion import active_sources, export_sources, mark_synced, sync_notion, write_notion
from .scout_probe import READERS, find_feed, next_batch, quality, skipping
from .scout_core import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    DEFAULT_BATCH, EMPLOYERS_DB, HN_THREADS, IDEAS_PAUSE, MAX_BATCH, RECHECK_DAYS, SEEDS, SEED_ORIGINS, SMALL_GUESS, TABLES, TECH_LIST_ORIGINS,
    TIER1_MIN_RELEVANT, _SEARCH, _get_json, _get_text, batch_for, clean_name, key_for, now, pending_count)
from .scout_candidates import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    LOCATION_WORDS, ROLE_WORDS, WIKIDATA_MAX_AGE, WIKIDATA_MIN_ROWS, WIKIDATA_QUERY, WIKIDATA_TIMEOUT_S, _seed_candidates,
    hacker_news_candidates, harvest, local_company_candidates, search_countries, seed_candidates, skipped_origins, starter_list,
    swissdevjobs_candidates, whiteboards_candidates, wikidata_candidates, wikidata_query, wikidata_rows)
from .scout_probe import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    JOB_SUBDOMAINS, JUDGES, READERS, READER_FILES, STACK, STOP_WORDS, SWISS_OR_ZURICH, belongs_to, board_url, find_feed, job_hosts,
    job_places, next_batch, quality, readers_version, relevant_roles, skipping, workday_url)
from .scout_notion import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    FEED_STATUS, _text, active_sources, excluded_companies, export_sources, mark_synced, notion_feeds, research_links, sync_notion,
    write_notion)
from .scout_index import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    FIT_MIN_INSTALLS, FIT_NAMES, MARKET_TERMS, MIN_INSTALLS, OWN_MIN_INSTALLS, POOL_MIN_INSTALLS, QUIET_DAYS, SWISS, board_stats,
    build_index, central_stats, dead_ends, fetch_boards, fetch_contributions, fits, health, market_coverage, pool_of, publish_index,
    publish_summary, record_unread, run_headline)


# The employers are checked in parallel threads: print() writes the text and its newline separately, so two lines could join
# ("…Hochschule BernScout: checked 6 of 15", 6 Oct 2026). One locked write per line, with its count.
PROGRESS_LOCK = threading.Lock()


def progress_line(text):
    sys.stdout.write(f'{text}\n')
    sys.stdout.flush()


def ai_ideas(db, harvest_sources=None):
    """Claude's ideas for new candidates (every run), or None: off, no AI available, tests that pass their own
    harvest sources, or a failure (the scout then simply carries on with the usual sources)."""
    from . import features
    from .ai import engine, scout_ideas
    if harvest_sources is not None or os.getenv('JOB_PILOTTO_FIXTURE_DIR') or not features.enabled('scout_ai') or not engine.ready():
        return None
    try:
        found = scout_ideas.run(db, load_search_config())
    except Exception as error:  # noqa: BLE001 — the ideas are a bonus: a failed call must never stop the scout
        print(f'Warning: scout ideas skipped: {type(error).__name__}: {error}')
        return None
    if found:
        print(f"Scout ideas: {found['companies']} companies and {found['directories']} from company lists. {found['note']}")
    return found


def run(db, batch=DEFAULT_BATCH, tracker=None, seeds=None, probe=ats.probe, harvest_sources=None, workers=6, static=None, budget=0):
    """Harvest, probe one batch, register what is useful. Returns (summary dict, list of outcomes).
    A board already crawled is a duplicate: the starter list (`static`, default config/sources.json), the feeds registered here and the Active Employers & Sources rows."""
    seeds = seeds or json.loads(SEEDS.read_text())
    if static is None:
        static = starter_list()
    # Each step says so as it starts: a run takes minutes, and the app's live log shows these lines ("Nothing to show yet" for four
    # minutes was the owner's find of 5 Oct 2026).
    from .ai import scout_ideas
    skip = skipped_origins(seeds, scout_ideas.technical(load_search_config()))
    print('Scout: reading the employer lists…' if not skip else
          'Scout: reading the employer lists (your roles are outside IT, so the tech company lists are left out)…')
    waiting = pending_count(db)
    if waiting > IDEAS_PAUSE and harvest_sources is None:
        added, ideas = 0, None
        print(f'Scout: {waiting} candidates still untried, so no new names this run (more than {IDEAS_PAUSE} wait); checking them first…')
    else:
        added = harvest(db, seeds, harvest_sources, skip)
        print(f'Scout: {added} new candidate(s) from the lists; asking the AI for ideas…')
        ideas = ai_ideas(db, harvest_sources)
        if ideas:
            added += harvest(db, seeds, [lambda: ideas['candidates']], skip)
    batch = batch_for(pending_count(db), batch)
    candidates, left = next_batch(db, batch, skip), 0
    # Employers some install (or the central scout) found with no readable job site lately are not probed again here; the next names take
    # their places, so a run probes its whole batch (7 Oct 2026: 52 of 92 were left out and the run checked 40).
    dead = set() if scout_core.CENTRAL else employer_index.central_nofeed()
    for _ in range(10):
        skipped = [c for c in candidates if key_for(c['name']) in dead and c['status'] != 'manual']
        if not skipped:
            break
        later = (now() + timedelta(days=30)).isoformat(timespec='seconds')
        for c in skipped:
            db.execute("UPDATE scout_candidates SET status='none', checked_at=?, next_check=?, checked_with=? WHERE key=?",
                       (now().isoformat(timespec='seconds'), later, READERS, c['key']))
        db.commit()
        left += len(skipped)
        candidates = next_batch(db, batch, skip)   # those just left out now wait 30 days, so the next names come in
    if left:
        print(f'Scout: {left} employer(s) left for 30 days: other installs found no readable job site there lately; others took their places.')
    print(f'Scout: checking {len(candidates)} employer(s)…')
    active = {(s.get('ats', 'greenhouse'), s.get('slug') or s['board']) for s in active_sources(db, tracker, static)}
    active |= {(r['ats'], r['slug']) for r in db.execute('SELECT ats, slug FROM feed_sources')}   # also one switched off: it is not new

    # A web search for an employer's own job site, when a key allows it (web_search.py); never for the end-to-end journey's fixtures.
    from .sources import web_search
    language = next((loc.get('language') for loc in (load_search_config().get('google_jobs') or {}).get('locations') or [] if isinstance(loc, dict)), '')
    search = None if harvest_sources is not None or os.getenv('JOB_PILOTTO_FIXTURE_DIR') or not web_search.provider() else \
        (lambda name: web_search.job_sites(name, language))
    if search:
        print(f'Scout: employers with no job site found are looked up with a web search ({web_search.provider()}).')
    # jobs.ch for an employer with no job site we can read: Swiss places only (it lists Swiss employers), never for the fixtures.
    from .sources import boards as job_boards
    lookup = None if harvest_sources is not None or os.getenv('JOB_PILOTTO_FIXTURE_DIR') or job_boards.swiss_place_word(load_search_config()) is None \
        else (lambda name: ats.jobsch_find(name, key_for))
    unread = []   # job systems a careers page named that could not be read: (system, why, company)

    done = []

    def check(candidate):
        try:
            return check_one(candidate)
        except Exception as error:  # noqa: BLE001  one employer's odd site must not end the run (7 Oct 2026: a TypeError at 90 of 91 lost them all)
            print(f"Warning: {candidate['name']} could not be checked: {type(error).__name__}: {str(error)[:160]}; counted as no job site we can "
                  'read, and checked again when the readers change')
            return {'status': 'none'}
        finally:
            with PROGRESS_LOCK:
                done.append(candidate['name'])
                progress_line(f"Scout: checked {len(done)} of {len(candidates)}: {candidate['name']}")

    note_site = []   # (candidate key, job site a web search found but nobody could read): saved as its careers address
    def check_one(candidate):
        if candidate['status'] == 'manual':
            return {'status': 'manual'}
        found = find_feed(candidate, probe, note=lambda system, slug, why: unread.append((system, why, candidate['name'])), search=search,
                          jobsch_lookup=lookup)
        if not found:
            site = candidate.get('found_site') or candidate.get('careers') or candidate.get('website') or ''
            if candidate.get('found_site'):   # where a person would land from "<company> jobs": the address to open, for everyone after
                note_site.append((candidate['key'], candidate['found_site']))
            why = careers.REFUSALS.get(re.sub(r'^https?://(www\.)?', '', site).split('/')[0].lower()) if site else None
            if why:   # its site refuses automated visitors: a person can still open it (src/sources/visits.py)
                from .sources import visits
                visits.refused(candidate['name'], site if '//' in site else f'https://{site}', why)
            return {'status': 'none'}
        system, slug, jobs = found
        if not jobs:
            return {'status': 'watch', 'ats': system, 'slug': slug}
        score, stats = quality(jobs)
        useful = stats['preferred'] >= 1 or (candidate['tier'] == 'Tier 1' and stats['relevant'] >= TIER1_MIN_RELEVANT)
        status = 'duplicate' if (system, slug) in active else ('found' if useful else 'low')
        return {'status': status, 'ats': system, 'slug': slug, 'quality': score, 'stats': stats}

    stamp = now()
    shared = {'found': [], 'none': [], 'failed': 0}   # the instant shares of this run, said once at the end (7 Oct 2026)
    def save(candidate, outcome):
        """One checked employer, written at once: a run stopped halfway keeps what it checked (7 Oct 2026)."""
        status = 'found' if outcome['status'] == 'duplicate' else outcome['status']
        next_check = (stamp + timedelta(days=RECHECK_DAYS[status])).isoformat(timespec='seconds') \
            if status in RECHECK_DAYS else None
        db.execute("""UPDATE scout_candidates SET status=?, ats=COALESCE(?, ats), slug=COALESCE(?, slug), quality=?,
            stats_json=?, checked_at=?, next_check=?, checked_with=? WHERE key=?""",
                   (status, outcome.get('ats'), outcome.get('slug'), outcome.get('quality'),
                    json.dumps(outcome.get('stats')) if outcome.get('stats') else None,
                    stamp.isoformat(timespec='seconds'), next_check, READERS, candidate['key']))
        if outcome['status'] == 'found':
            db.execute("""INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at)
                VALUES (?, ?, ?, ?, ?, ?)""", (outcome['ats'], outcome['slug'], candidate['name'], candidate['tier'],
                                               outcome['quality'], stamp.isoformat(timespec='seconds')))
        db.commit()
        if not scout_core.CENTRAL and outcome['status'] in ('found', 'none'):   # to the central list right away (opt-in): closing the app loses nothing
            from . import contribute
            if outcome['status'] == 'found':
                ok = contribute.share_now(feed={'ats': outcome['ats'], 'slug': outcome['slug'], 'company': candidate['name'][:120],
                                           'how': contribute.how_of(candidate.get('origin')), 'site': candidate.get('careers') if str(candidate.get('careers') or '').startswith('https://') else None,
                                           'jobs': int((outcome.get('stats') or {}).get('jobs') or 0)})
            else:
                site = re.sub(r'^https?://(www\.)?', '', candidate.get('website') or '').split('/')[0].lower() or None
                ok = contribute.share_now(dead={'company': candidate['name'][:120], 'host': site})
            if ok:
                shared[outcome['status']].append(candidate['name'])
            elif contribute.enabled():
                shared['failed'] += 1
        if tracker and outcome['status'] != 'duplicate':
            try:
                write_notion(tracker, candidate, outcome)
                mark_synced(db, candidate['key'])
            except Exception as error:
                print(f"Warning: Notion not updated for {candidate['name']}: {type(error).__name__}: {error}")


    # Each employer is saved as soon as it is checked, here on this thread (the database is not shared across threads); a stop (SIGTERM)
    # leaves at once instead of waiting for the whole batch (src/notion/cron_runs.py _on_terminate).
    # A time budget (the app: SCOUT_BUDGET_S): no new check starts after it, the ones running finish, the rest wait for the next run (owner,
    # 7 Oct 2026: "runs for too long"; 91 checks at 20-45 s each took over half an hour). Each one is saved as it ends, so nothing is lost.
    outcomes = [None] * len(candidates)
    deadline = time.monotonic() + budget if budget else None
    pool = ThreadPoolExecutor(max_workers=workers)
    try:
        todo, futures = iter(enumerate(candidates)), {}
        def more():
            while len(futures) < workers and (deadline is None or time.monotonic() < deadline):
                nxt = next(todo, None)
                if nxt is None:
                    return
                futures[pool.submit(check, nxt[1])] = nxt[0]
        more()
        while futures:
            future = next(as_completed(futures))
            i = futures.pop(future)
            outcomes[i] = future.result()
            save(candidates[i], outcomes[i])
            more()
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    if None in outcomes:
        done_now = sum(1 for o in outcomes if o is not None)
        span = f'{budget // 60} min' if budget >= 60 else f'{budget} s'
        print(f'Scout: its {span} are up: {done_now} of {len(candidates)} checked (the ones under way finished); the other {len(candidates) - done_now} wait for the next run.')
        kept = [(c, o) for c, o in zip(candidates, outcomes) if o is not None]
        candidates, outcomes = [c for c, _ in kept], [o for _, o in kept]
    for key, url in note_site:
        db.execute("UPDATE scout_candidates SET careers = ? WHERE key = ? AND COALESCE(careers, '') = ''", (url, key))
    record_unread(db, unread)

    if shared['found'] or shared['none'] or shared['failed']:
        names = lambda items: ', '.join(items[:10]) + (f' and {len(items) - 10} more' if len(items) > 10 else '')  # noqa: E731
        print(f"Pool: shared {len(shared['found'])} new employers ({names(shared['found']) or 'none'}) and {len(shared['none'])} dead ends "
              f"({names(shared['none']) or 'none'}) as they were found" + (f"; {shared['failed']} not sent, the end-of-run share carries them" if shared['failed'] else ''))
    where, params = skipping(skip)
    queued = db.execute(f"SELECT COUNT(*) FROM scout_candidates WHERE status = 'pending' {where}", params).fetchone()[0]
    total_feeds = db.execute('SELECT COUNT(*) FROM feed_sources WHERE active = 1').fetchone()[0]
    # Each run checks names it never checked before (pending), and only re-checks one whose wait is over (RECHECK_DAYS): said in the card, so
    # "15 checked" is never read as the same list again (6 Oct 2026).
    first = sum(1 for c in candidates if not c.get('checked_at'))
    return {'checked': len(candidates), 'first_time': first, 'left': left, 'harvested': added, 'queued': queued, 'total_feeds': total_feeds,
            'ideas': {k: ideas[k] for k in ('companies', 'directories', 'note')} if ideas else None}, \
        list(zip(candidates, outcomes))


def telegram_summary(summary, results):
    found = sorted([(c, o) for c, o in results if o['status'] == 'found'], key=lambda x: -x[1]['quality'])
    counts = {s: sum(1 for _, o in results if o['status'] == s) for s in ('none', 'low', 'manual', 'duplicate', 'watch')}
    blocks = []
    for i, (c, o) in enumerate(found, 1):
        s = o['stats']
        tier = ' · Tier 1' if c['tier'] == 'Tier 1' else ''
        places = s['places'][:3]
        blocks.append(tgcard.block(
            f"{i}. {escape(c['name'])} · Source quality {o['quality']}{tier}",
            escape(tgcard.dot(f"{s['relevant']} matching roles", f"{s['preferred']} in preferred locations")),
            tgcard.fact('Location' if len(places) == 1 else 'Locations', ', '.join(places)),
            tgcard.fact('Platform', o['ats'].capitalize())))
    if not found:
        blocks.append('No new useful feeds in this batch.')
    detail = [f"{counts['none']} without a job feed we can read (their own job site, or jobs.ch)", f"{counts['low']} low relevance"]
    left = summary.get('left') or 0
    if left:   # not checked here: other installs found no job site there lately (7 Oct 2026: 52 of 92 went unsaid)
        detail.append(f"{left} set aside for 30 days (other installs found no job site we can read there)")
    if counts['watch']:
        detail.append(f"{counts['watch']} careers page{'s' if counts['watch'] != 1 else ''} with no open jobs today (watched weekly)")
    if counts['manual']:
        detail.append(f"{counts['manual']} Tier 1 on manual watch")
    if summary.get('ideas'):
        ideas = summary['ideas']
        blocks.append(tgcard.block('New ideas', escape(f"{ideas['companies']} companies and {ideas['directories']} from company lists queued"),
                                   escape(ideas['note'])))
    rest = tgcard.dot(*detail, f"{summary['total_feeds']} feeds crawled", f"{summary['queued']} candidates queued",
                      f"{summary['harvested']} new candidates found" if summary['harvested'] else '')
    blocks.append(tgcard.block('Not added', escape(rest)))
    plural = 's' if len(found) != 1 else ''
    first = summary.get('first_time')
    again = summary['checked'] - first if first is not None else 0
    # Checked again only once every new name was tried (next_batch): said, so it is not read as effort spent instead of new names (7 Oct 2026).
    return tgcard.card('New employer sources', tgcard.dot(f"{summary['checked']} checked", f"{first} new to the search" if first is not None else '',
                                                         f"{again} checked again (no new names left)" if again else '',
                                                         f"{left} set aside" if left else '', f"{len(found)} new source{plural}"), blocks,
                       emoji='🔎', footer='Source quality measures the source, not your job fit.')


def ai_cost_line(what, usd, api_calls, plan_calls, calls):
    """What a run's AI cost, in words: dollars only for calls on the API key; calls through Claude Code are on the user's Claude plan
    (6 Oct 2026: "$0.000 in 21 call(s)" read as broken to a Claude Code user)."""
    if plan_calls and not api_calls:
        return f'AI of this {what}: {plan_calls} call(s) on your Claude plan (Claude Code: no cost per call)'
    if plan_calls:
        return f'AI cost of this {what}: ${usd:.3f} for {api_calls} call(s) on your API key, plus {plan_calls} on your Claude plan'
    return f'AI cost of this {what}: ${usd:.3f} in {calls} call(s)'


def report_ai_cost(side):
    """Print what this run's AI calls cost, and write {usd, calls} to JOB_PILOTTO_AI_COST_FILE when set (the central scout's workflow
    reports it to the owner's /ai-cost page). Always written when asked, even $0: a job that spent nothing must still show up."""
    usd, calls = float(side.get('usd') or 0), int(side.get('done') or 0)
    print(ai_cost_line('scout run', usd, int(side.get('api_calls') or 0), int(side.get('cli_calls') or 0), calls))
    target = os.getenv('JOB_PILOTTO_AI_COST_FILE')
    if target:
        Path(target).write_text(json.dumps({'usd': round(usd, 6), 'calls': calls}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=JOBS_DB)
    parser.add_argument('--batch', type=int, default=DEFAULT_BATCH, help='candidates probed per run')
    parser.add_argument('--budget', type=int, default=0, help='seconds: no new check starts after this; the rest wait for the next run (0 = none)')
    parser.add_argument('--send', action='store_true', help='send the summary to Telegram')
    parser.add_argument('--log-run', action='store_true', help='log this run to Notion ⏱️ Search runs (the desktop app does)')
    parser.add_argument('--publish-index', action='store_true',
                        help='the central scout: after the run, verify every feed and upload the employer index '
                             '(needs INDEX_PUBLISH_KEY; URL: JOB_PILOTTO_INDEX_URL or the default)')
    parser.add_argument('--sync-notion', action='store_true',
                        help='write the employers already checked on this computer that Employers & Sources lacks (the app runs it when '
                             'Notion is connected), then stop')
    parser.add_argument('--export-sources', action='store_true',
                        help='write config/sources.json: the shared starter list of verified public feeds '
                             '(sources.json + Active Employers & Sources rows); needs NOTION_TOKEN')
    args = parser.parse_args()
    if args.sync_notion:
        tracker = notion.Tracker.from_env()
        if not tracker or not scout_core.EMPLOYERS_DB:
            print('Employers: Notion is not connected; nothing to write.')
            return 0
        with store.connect(args.db) as db:
            db.executescript(TABLES)
            written, failed = sync_notion(db, tracker)
        print(f'Employers: {written} written to Notion')   # each one not written said so in its own Warning line
        return 1 if failed and not written else 0
    scout_core.CENTRAL = bool(args.publish_index)   # the central scout: its full lists, published to every install
    if args.export_sources:
        tracker = notion.Tracker.from_env()
        if not tracker:
            raise SystemExit('--export-sources reads Employers & Sources: set NOTION_TOKEN')
        kept, failed = export_sources(tracker)
        print(f'Wrote {len(kept)} feeds ({sum(k["jobs"] for k in kept):,} open jobs) to config/sources.json')
        for item in failed:
            print(f"  left out {item['company']} ({item['ats']}:{item['slug']}): {item['error']}")
        return 0
    from .features import disabled
    if disabled('scout'):
        print('Source scout is off (JOB_PILOTTO_DISABLE includes scout).')
        return 0
    tracker = notion.Tracker.from_env()
    logged = tracker and (args.send or args.log_run)
    if logged:
        cron_runs.auto_begin(tracker)  # the scout's ⏱️ Search runs row opens when it starts
    log = cron_runs.new_run('scout')
    with store.connect(args.db) as db:
        summary, results = run(db, args.batch, tracker, budget=args.budget)
        if tracker:   # employers checked earlier without Notion, or whose write failed, catch up now
            written, failed = sync_notion(db, tracker)
            if written or failed:
                print(f'Employers: {written} checked earlier written to Notion')
        if not scout_core.CENTRAL:   # what this run found goes to the central list right away (opt-in; src/contribute.py), not with the next jobs check
            try:
                from . import contribute
                contribute.maybe_send(active_sources(db, tracker, starter_list()), {'sources': []}, tracker, db=db)
            except Exception as error:  # noqa: BLE001 — the pool never affects a run
                print(f'Warning: pool contribution skipped: {type(error).__name__}: {error}')
        if args.publish_index:
            key = os.getenv('INDEX_PUBLISH_KEY')
            if not key:
                raise SystemExit('--publish-index needs INDEX_PUBLISH_KEY')
            index_url = os.getenv('JOB_PILOTTO_INDEX_URL') or employer_index.URL
            contributions, shared_dead = fetch_contributions(index_url, key, with_nofeed=True)
            swiss_titles = []
            feeds_out, failed = build_index(db, json.loads((CONFIG / 'sources.json').read_text()), contributions=contributions,
                                            boards=json.loads(SEEDS.read_text()).get('boards', []), swiss_titles=swiss_titles)
            stats = central_stats(db, feeds_out, market_coverage(swiss_titles))
            boards = board_stats(fetch_boards(index_url, key))
            count = publish_index(feeds_out, index_url, key, stats=stats, nofeed=dead_ends(db, shared_dead), boards=boards)
            print(publish_summary(feeds_out, contributions, boards))
            print('Market coverage (our index / jobs.ch): ' + ', '.join(f"{m['term']} {m['ours']}/{m['jobsch']}" for m in stats['market']))
            print(f'Published {count} feeds to the employer index ({len(failed)} did not answer)')
    from .ai import cost as ai_cost
    if ai_cost.SIDE:   # AI ideas, link picks and page reads of this scout run: logged like any AI step
        log['sources'] = dict(ai_cost.SIDE)
    report_ai_cost(ai_cost.SIDE)
    message = telegram_summary(summary, results)
    log['headline'] = run_headline(message)
    log['subject'] = cron_runs.counted(sum(1 for _, outcome in results if outcome['status'] == 'found'), 'new feed')
    if args.send and not disabled('telegram'):
        print(message)
        telegram.send(message, *telegram.credentials())
    else:
        telegram.to_app(message)  # no Telegram: the desktop app shows the summary
    if logged:
        cron_runs.log_run(tracker, log)


if __name__ == '__main__':
    main()
