"""Reading the job boards found for the user's countries (src/ai/board_ideas.py; spec docs/superpowers/specs/2026-10-08-job-board-discovery.md).
No code per board: each board's public search page, filled with the user's own board searches and places, is read like a careers page
(schema.org JobPosting first (its hiringOrganization is the job's company, else "via <board>"; also from the job pages a list links to), then the job links and the AI page reader within its caps, then learned recipes: src/sources/careers.py).
A board whose page only scripts fill first tries what it declares itself (feed alternates, robots.txt sitemaps: board_routes.py; the route
that worked is kept per host). A board that refuses (401/403/429, a bot check) or gives no route is marked 'browser' (the visit list offers
it) and looked at again after 30 days; one that gave no relevant job (title and place the search wants) three reads running is 'dead'
(src/sources/board_yield.py). The outcome of each read is kept in data/found_boards.json
('boards'), a cache. Wired as one aggregator, "Job boards found" (src/sources/aggregators.py). Tests: tests/test_found_boards.py."""
import urllib.error
import urllib.parse
from datetime import datetime, timezone

from ..progress import Ticker
from . import board_employers, board_routes, careers

MAX_SEARCHES = 2      # the user's board searches per board per run
MAX_PLACES = 2        # and places
BROWSER_RETRY_DAYS = 30   # a board marked 'browser' is looked at again after this long (its page or routes may have changed)


def _terms(search):
    from ..notion.search_settings import terms
    return (terms(search.get('jobs_board_search_queries')) or terms(search.get('role_keywords')))[:MAX_SEARCHES]


def _places(search):
    from .. import places
    return places.words_of(search)[:MAX_PLACES] or ['']


def read_board(board, search, fetch=careers.get_text, route=None):
    """(jobs, state, route) for one board: jobs in the aggregators' shape; state 'ok', 'empty' or 'browser'; route = the declared feed or
    sitemap that gave the jobs (kept, tried first next time), None when the search page itself did. A script-only page tries its declared
    routes before 'browser' (src/sources/board_routes.py)."""
    from .aggregators import _job
    jobs, state = [], 'empty'
    try:
        if route:
            jobs = board_routes.follow(route, fetch, board, _terms(search))
            if jobs:
                return jobs, 'ok', route
    except board_routes.Stop:
        return [], 'browser', None
    for term in _terms(search):
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
                    return jobs, 'browser', None, None
                continue
            found = careers.jsonld_jobs(page, url) or careers.read_page_from(page, url, fetch)
            if not found and careers._shell(page):   # only scripts fill it: what the board declares itself, else a visit reads it
                try:
                    declared, found_route = board_routes.discover(page, url, fetch, board, _terms(search))
                except board_routes.Stop:
                    return jobs, 'browser', None
                return (declared, 'ok', found_route) if declared else (jobs, 'browser', None)
            for job in found:
                jobs.append(_job(board['host'], job['id'] or job['url'], job['title'], job.get('employer') or f"via {board['name']}",
                                 job['location'], job['url'], job.get('date_posted', ''), job.get('description', ''), job.get('remote'), job.get('salary', '')))
            state = 'ok' if jobs else state
    return list({job['url']: job for job in jobs}.values()), state, None


def _retry_due(entry, now):
    try:
        last = datetime.fromisoformat(entry['last_read'])
    except (KeyError, ValueError):
        return True
    return ((now or datetime.now(timezone.utc)) - last).days >= BROWSER_RETRY_DAYS


def read(search, boards=None, fetch=careers.get_text, now=None, is_relevant=None):
    """Every job of the found boards for this search; each board's yield kept (jobs listed, relevant ones), boards marked browser or dead
    skipped, untried boards limited (board_yield.pick)."""
    from ..ai import board_ideas
    from . import board_yield
    data = board_ideas.load()
    kept = data.setdefault('boards', {})
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
    jobs = []
    todo = board_yield.pick(boards if boards is not None else board_ideas.ideas(search), kept, lambda entry: _retry_due(entry, now))
    ticker = Ticker('Reading job boards', len(todo), every=0)   # the driver persona's board read was silent for 7 minutes (18 Oct 2026)
    for done, board in enumerate(todo, 1):
        entry = kept.setdefault(board['host'], {'name': board['name'], 'search_url': board['search_url'], 'misses': 0})
        found, state, route = read_board(board, search, fetch, entry.get('route'))
        entry.pop('route', None)
        if route:
            entry['route'] = route
        relevant = (is_relevant or board_yield.is_relevant)(found) if found else []
        entry.update({'last_read': stamp, 'countries': board.get('countries') or [], 'kinds': board.get('kinds') or [],
                      'source_kind': board.get('source_kind') or 'general'})
        board_yield.record(entry, len(found), len(relevant), state)
        print(f"Job boards found: {board['name']} {len(found)} job(s), {len(relevant)} relevant{'' if state != 'browser' else ' (refuses automated reading: offered as a visit)'}", flush=True)
        jobs.extend(found)
        ticker.tick(done, f" · {board['name']}")
    board_ideas.save(data)
    board_employers.note(jobs, 'Job boards found')
    return jobs
