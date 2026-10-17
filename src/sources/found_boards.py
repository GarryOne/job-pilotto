"""Reading the job boards found for the user's countries (src/ai/board_ideas.py; spec docs/superpowers/specs/2026-10-08-job-board-discovery.md).
No code per board: each board's public search page, filled with the user's own board searches and places, is read like a careers page
(schema.org JobPosting first, then the job links and the AI page reader within its caps, then learned recipes: src/sources/careers.py).
A board whose page only scripts fill first tries what it declares itself (feed alternates, robots.txt sitemaps: board_routes.py; the route
that worked is kept per host). A board that refuses (401/403/429, a bot check) or gives no route is marked 'browser' (the visit list offers
it) and looked at again after 30 days; one that found no job three reads running is 'dead'. The outcome of each read is kept in data/found_boards.json
('boards'), a cache. Wired as one aggregator, "Job boards found" (src/sources/aggregators.py). Tests: tests/test_found_boards.py."""
import urllib.error
import urllib.parse
from datetime import datetime, timezone

from . import board_routes, careers

MAX_SEARCHES = 2      # the user's board searches per board per run
MAX_PLACES = 2        # and places
DEAD_AFTER = 3        # reads in a row that found no job
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
            employers = board_routes.companies(page)
            for job in found:
                jobs.append(_job(board['host'], job['id'] or job['url'], job['title'], employers.get(job['url']) or f"via {board['name']}",
                                 job['location'], job['url'], job.get('date_posted', ''), job.get('description', ''), job.get('remote'), job.get('salary', '')))
            state = 'ok' if jobs else state
    return list({job['url']: job for job in jobs}.values()), state, None


def _retry_due(entry, now):
    try:
        last = datetime.fromisoformat(entry['last_read'])
    except (KeyError, ValueError):
        return True
    return ((now or datetime.now(timezone.utc)) - last).days >= BROWSER_RETRY_DAYS


def read(search, boards=None, fetch=careers.get_text, now=None):
    """Every job of the found boards for this search; each board's outcome kept, and boards marked browser or dead skipped."""
    from ..ai import board_ideas
    data = board_ideas.load()
    kept = data.setdefault('boards', {})
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
    jobs = []
    for board in boards if boards is not None else board_ideas.ideas(search):
        entry = kept.setdefault(board['host'], {'name': board['name'], 'search_url': board['search_url'], 'misses': 0})
        if entry.get('state') == 'dead' or (entry.get('state') == 'browser' and not _retry_due(entry, now)):
            continue
        found, state, route = read_board(board, search, fetch, entry.get('route'))
        entry.pop('route', None)
        if route:
            entry['route'] = route
        entry.update({'last_read': stamp, 'jobs': len(found), 'countries': board.get('countries') or [], 'kinds': board.get('kinds') or []})
        entry['misses'] = 0 if found else entry.get('misses', 0) + 1
        entry['state'] = 'browser' if state == 'browser' else 'dead' if entry['misses'] >= DEAD_AFTER else 'ok' if found else 'empty'
        print(f"Job boards found: {board['name']} {len(found)} job(s){'' if state != 'browser' else ' (refuses automated reading: offered as a visit)'}", flush=True)
        jobs.extend(found)
    board_ideas.save(data)
    return jobs
