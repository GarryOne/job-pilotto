"""Reading the job boards found for the user's countries (src/ai/board_ideas.py; spec docs/superpowers/specs/2026-10-08-job-board-discovery.md).
No code per board: each board's public search page, filled with the user's own board searches and places, is read like a careers page
(schema.org JobPosting first (its hiringOrganization is the job's company, else "via <board>"; also from the job pages a list links to), then the job links and the AI page reader within its caps, then learned recipes: src/sources/careers.py).
A board whose page only scripts fill first tries what it declares itself (feed alternates, robots.txt sitemaps: board_routes.py; the route
that worked is kept per host). A board that refuses (401/403/429, a bot check) or gives no route is marked 'browser' (the visit list offers
it) and looked at again after 30 days; one that gave no job in the user's places three runs running is dropped (its history is the job
cache's source_yield table: src/sources/board_yield.py dead). The outcome of each read is kept in data/found_boards.json
('boards'), a cache. Wired as one aggregator, "Job boards found" (src/sources/aggregators.py). The boards that gave other installs like
this one their jobs are read first, the top 2 in the first-jobs slice (src/first_jobs.py; their jobs are handed to the full read, not
fetched twice: the full read reuses the slice's pages). Tests: tests/test_found_boards.py, tests/test_proven_boards.py."""
import sqlite3
import time
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone

from .. import run_counts
from ..progress import Ticker
from . import board_employers, board_forms, board_pages, board_routes, board_yield, careers

MAX_SEARCHES = 2      # the user's board searches per board in the first-jobs slice (fast)
FULL_SEARCHES = 5     # and in the full read: every query the strategy has, up to this many (a board gave 3 jobs from 2 of the driver's 5, 18 Oct 2026)
IDLE_STOP = 2         # the full read stops a board after this many queries in a row that add no new job
MAX_PLACES = 2        # and places
BROWSER_RETRY_DAYS = 30   # a board marked 'browser' is looked at again after this long (its page or routes may have changed)
BOARD_WORKERS = 4         # boards read at once (each its own site, its own pages one after another): the slice ends with its slowest board, not their sum
EARLY_MINUTES = 60        # a board read in the first-jobs slice hands its jobs to the same search's full read for this long
_early = {}               # {host: (monotonic time, {url: page})}: the pages this search's first-jobs slice fetched


def _terms(search, limit=MAX_SEARCHES):
    from ..notion.search_settings import terms
    return (terms(search.get('jobs_board_search_queries')) or terms(search.get('role_keywords')))[:limit]


def _places(search):
    from .. import places
    return places.words_of(search)[:MAX_PLACES] or ['']


def read_board(board, search, fetch=careers.get_text, route=None, early=False):
    """(jobs, state, route) for one board: jobs in the aggregators' shape, each once; state 'ok', 'empty' or 'browser'; route = the declared feed or
    sitemap that gave the jobs (kept, tried first next time), None when the search page itself did. A page no free step reads tries its
    declared routes (src/sources/board_routes.py); a script-only one with none is 'browser'; a readable one goes to the AI page reader once
    per board per run, within its caps, and the recipe it leaves replays with no model next time."""
    jobs, state, route = _read(board, search, fetch, route, early)
    return list({job['url']: job for job in jobs}.values()), state, route   # every way out: a board refusing mid-read kept its repeats (18 Oct 2026)


def _read(board, search, fetch, route, early):
    from .aggregators import _job
    jobs, state, asked_routes, asked_ai = [], 'empty', False, False
    try:
        if route:
            jobs = board_routes.follow(route, fetch, board, _terms(search))
            if jobs:
                return jobs, 'ok', route
    except board_routes.Stop:
        return [], 'browser', None
    seen, idle = set(), 0
    for number, term in enumerate(_terms(search, MAX_SEARCHES if early else FULL_SEARCHES)):
        if not early and number >= MAX_SEARCHES and idle >= IDLE_STOP:   # a board that stopped giving new jobs is not asked again
            break
        for place in (_places(search) if '{place}' in board['search_url'] else ['']):
            url = board['search_url'].replace('{role}', urllib.parse.quote_plus(term)).replace('{place}', urllib.parse.quote_plus(place))
            try:
                page = fetch(url)
            except urllib.error.HTTPError as error:
                careers.note_refusal(url, error)
                if error.code in (401, 403, 429):
                    return jobs, 'browser', None
                continue
            except (urllib.error.URLError, OSError, ValueError) as error:
                if type(error).__name__ == 'Refused':
                    return jobs, 'browser', None
                continue
            found = careers.jsonld_jobs(page, url) or careers.read_page_from(page, url, fetch)
            if not found and not asked_routes:   # nothing readable on the page (scripts fill the cards, or it is only a frame): what the board declares itself
                asked_routes = True
                try:
                    declared, found_route = board_routes.discover(page, url, fetch, board, _terms(search))
                except board_routes.Stop:
                    return jobs, 'browser', None
                if declared:
                    return declared, 'ok', found_route
                if careers._shell(page):   # a frame with no route: a visit reads it
                    return jobs, 'browser', None
            if not found and not asked_ai:   # an open, readable page no free step reads: the AI reads it once (its caps), and the recipe it
                asked_ai = True              # leaves reads it free from then on (owner, 18 Oct 2026; src/sources/page_recipes.py)
                found = careers._asked(url, page, [], fetch)
            if found and not early:   # the next pages of these results, while they still give relevant jobs (board_pages.py)
                found = found + board_pages.more(url, page, found, fetch, lambda markup, link: careers.jsonld_jobs(markup, link) or careers.read_page_from(markup, link, fetch),
                                                 lambda some: board_yield.is_relevant(some))
            for job in found:
                jobs.append(_job(board['host'], job['id'] or job['url'], job['title'], job.get('employer') or f"via {board['name']}",
                                 job['location'], job['url'], job.get('date_posted', ''), job.get('description', ''), job.get('remote'), job.get('salary', '')))
            state = 'ok' if jobs else state
        new = {job['url'] for job in jobs} - seen
        seen |= new
        idle = 0 if new else idle + 1
    return jobs, state, None


def _retry_due(entry, now):
    try:
        last = datetime.fromisoformat(entry['last_read'])
    except (KeyError, ValueError):
        return True
    return ((now or datetime.now(timezone.utc)) - last).days >= BROWSER_RETRY_DAYS


def _dead():
    """The boards dropped by their history (board_yield.dead) in this install's job cache; none before its first search."""
    from .. import paths
    from . import board_yield
    path = paths.DATA / 'jobs.sqlite'
    if not path.exists():
        return set()
    with closing(sqlite3.connect(path)) as db:
        return board_yield.dead(db)


def read_since(stamp):
    """{board host: relevant jobs} of the found boards read at or after `stamp` (ISO, UTC): this search's reads, for source_yield."""
    from ..ai import board_ideas
    from .careers_parse import registrable
    return {registrable(host): int(entry.get('relevant') or 0) for host, entry in (board_ideas.load().get('boards') or {}).items()
            if (entry.get('last_read') or '') >= stamp}


def _another_way(board, entry, proposed, search, fetch, judge, before):
    """(jobs, state, relevant) for a board whose proposed link gave no relevant job: through the search form on its home page
    (src/sources/board_forms.py), kept as the board's link (the pool share sends it, src/contribute.py); else the job list it declares
    itself (a feed, its home page's own data or the sitemap in robots.txt: board_routes, job pages naming the search words first), kept
    as its route (owner, 18 Oct 2026: Randstad listed warehouse jobs for "financial analyst" and has a job sitemap). Else `before`; the
    board is not looked at again while the proposed link stays the same."""
    entry['form_for'] = proposed
    page = board_forms.home(board, fetch)
    for template in board_forms.home_templates(board, fetch, page):
        try:
            again, state, _ = read_board({**board, 'search_url': template}, search, fetch, None)
        except Exception:  # noqa: BLE001 — a form link that fails: the next one, or the proposed link's result
            continue
        relevant = judge(again) if again else []
        if relevant:
            entry['form_url'] = entry['search_url'] = template
            print(f"Job boards found: {board['name']} read through its own search form", flush=True)
            return again, state, relevant
    try:
        listed, route = board_routes.discover(page[1], page[0], fetch, board, _terms(search, FULL_SEARCHES))
    except board_routes.Stop:   # its own list refused us: the search page's answer stands, the board is not marked for a visit
        return before
    except Exception:  # noqa: BLE001 — a fallback never breaks the read: the search page's answer stands
        return before
    relevant = judge(listed) if listed else []
    if relevant:
        entry['route'], entry['route_kind'] = route, route['kind']   # read_board follows it first from then on
        print(f"Job boards found: {board['name']} read from its own job list ({route['kind']})", flush=True)
        return listed, 'ok', relevant
    return before


def read(search, boards=None, fetch=None, now=None, is_relevant=None, dead=None, early=False):
    """Every job of the found boards for this search; each board's yield kept (jobs listed, relevant ones), boards marked browser or dropped
    by their history skipped, untried boards limited (board_yield.pick). early: the first-jobs slice; its jobs are kept for this search's
    full read, which asks the board in full and serves the pages the slice fetched from them instead of fetching them again."""
    from ..ai import board_ideas
    fetch = fetch or careers.get_text   # looked up when called: a test's or a run's own fetcher applies
    from . import board_yield
    data = board_ideas.load()
    kept = data.setdefault('boards', {})
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
    jobs = []
    todo = board_yield.pick(boards if boards is not None else board_ideas.ideas(search), kept, lambda entry: _retry_due(entry, now),
                            dead if dead is not None else _dead())
    ticker = Ticker('Reading job boards', len(todo), every=0)   # the driver persona's board read was silent for 7 minutes (18 Oct 2026)
    reads = []
    for board in todo:
        entry = kept.setdefault(board['host'], {'name': board['name'], 'search_url': board['search_url']})
        proposed = board['search_url']
        if entry.get('form_url') and entry.get('form_for') == proposed:   # the board's own search form gave relevant jobs for this link
            board = {**board, 'search_url': entry['form_url']}
        handed = _early.pop(board['host'], None)
        reads.append((board, entry, handed[1] if handed and time.monotonic() - handed[0] < EARLY_MINUTES * 60 and not early else {}, {}, proposed))

    def one(item):   # one board's pages; what is kept of it is decided below, in the list's order, in this thread
        board, entry, pages, fetched, _ = item

        def through(url):   # a page this search's first-jobs slice fetched is served from it, not asked again
            if url in pages:
                return pages[url]
            page = fetch(url)
            if early:
                fetched[url] = page
            return page
        return read_board(board, search, through, entry.get('route'), early=early)
    with ThreadPoolExecutor(max_workers=BOARD_WORKERS) as pool:   # 18 Oct 2026: Chisinau's 2 slice boards gave nothing, its 4th and 8th 14 jobs
        for done, ((board, entry, _, fetched, proposed), (found, state, route)) in enumerate(zip(reads, pool.map(one, reads)), 1):
            if early:   # the full read asks every query and the next pages, reusing these
                _early[board['host']] = (time.monotonic(), fetched)
            entry.pop('route', None)
            entry.pop('route_kind', None)
            if route:
                entry['route'] = route
                entry['route_kind'] = route['kind']   # sitemap, feed, json or state: the source queue ranks by it
            judge = is_relevant or board_yield.is_relevant
            relevant = judge(found) if found else []
            if not (early or relevant or route) and state != 'browser' and entry.get('form_for') != proposed:   # once per proposed link
                found, state, relevant = _another_way(board, entry, proposed, search, fetch, judge, (found, state, relevant))
            entry.update({'last_read': stamp, 'countries': board.get('countries') or [], 'kinds': board.get('kinds') or [],
                          'source_kind': board.get('source_kind') or 'general'})
            board_yield.record(entry, len(found), len(relevant), state)
            print(f"Job boards found: {board['name']} {len(found)} job(s), {len(relevant)} relevant{'' if state != 'browser' else ' (refuses automated reading: offered as a visit)'}", flush=True)
            run_counts.looked(found)
            run_counts.matched(relevant)
            jobs.extend(found)
            ticker.tick(done, f" · {board['name']}")
    board_ideas.save(data)
    board_employers.note(jobs, 'Job boards found')
    return jobs
