"""Reading the job boards found for the user's countries (src/ai/board_ideas.py; spec docs/superpowers/specs/2026-10-08-job-board-discovery.md).
No code per board: each board's public search page, filled with the user's own board searches and places, is read like a careers page
(schema.org JobPosting first, then the job links and the AI page reader within its caps, then learned recipes: src/sources/careers.py).
A board that refuses (401/403/429, a bot check) or whose page only scripts fill is marked 'browser' and never fetched again (the visit
list offers it); one that found no job three reads running is 'dead'. The outcome of each read is kept in data/found_boards.json
('boards'), a cache. Wired as one aggregator, "Job boards found" (src/sources/aggregators.py). Tests: tests/test_found_boards.py."""
import json
import re
import urllib.error
import urllib.parse
from datetime import datetime, timezone

from . import careers

MAX_SEARCHES = 2      # the user's board searches per board per run
MAX_PLACES = 2        # and places
DEAD_AFTER = 3        # reads in a row that found no job


def _terms(search):
    from ..notion.search_settings import terms
    return (terms(search.get('jobs_board_search_queries')) or terms(search.get('role_keywords')))[:MAX_SEARCHES]


def _places(search):
    from .. import places
    return places.words_of(search)[:MAX_PLACES] or ['']


def _companies(markup):
    """{job url: employer} from the page's JobPosting data (hiringOrganization), where it says."""
    out = {}
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', markup, re.S | re.I):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        for item in data if isinstance(data, list) else data.get('@graph') or [data]:
            org = isinstance(item, dict) and item.get('hiringOrganization')
            name = org.get('name') if isinstance(org, dict) else org if isinstance(org, str) else ''
            if name and item.get('url'):
                out[item['url']] = str(name)[:120]
    return out


def read_board(board, search, fetch=careers.get_text):
    """(jobs, state) for one board: jobs in the aggregators' shape; state 'ok', 'empty' or 'browser'."""
    from .aggregators import _job
    jobs, state = [], 'empty'
    for term in _terms(search):
        for place in (_places(search) if '{place}' in board['search_url'] else ['']):
            url = board['search_url'].replace('{role}', urllib.parse.quote_plus(term)).replace('{place}', urllib.parse.quote_plus(place))
            try:
                page = fetch(url)
            except urllib.error.HTTPError as error:
                careers.note_refusal(url, error)
                if error.code in (401, 403, 429):
                    return jobs, 'browser'
                continue
            except (urllib.error.URLError, OSError, ValueError) as error:
                if type(error).__name__ == 'Refused':
                    return jobs, 'browser'
                continue
            found = careers.jsonld_jobs(page, url) or careers.read_page_from(page, url, fetch)
            if not found and careers._shell(page):   # only scripts fill it: a visit reads it
                return jobs, 'browser'
            employers = _companies(page)
            for job in found:
                jobs.append(_job(board['host'], job['id'] or job['url'], job['title'], employers.get(job['url']) or f"via {board['name']}",
                                 job['location'], job['url'], job.get('date_posted', ''), job.get('description', ''), job.get('remote'), job.get('salary', '')))
            state = 'ok' if jobs else state
    return list({job['url']: job for job in jobs}.values()), state


def read(search, boards=None, fetch=careers.get_text, now=None):
    """Every job of the found boards for this search; each board's outcome kept, and boards marked browser or dead skipped."""
    from ..ai import board_ideas
    data = board_ideas.load()
    kept = data.setdefault('boards', {})
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
    jobs = []
    for board in boards if boards is not None else board_ideas.ideas(search):
        entry = kept.setdefault(board['host'], {'name': board['name'], 'search_url': board['search_url'], 'misses': 0})
        if entry.get('state') in ('browser', 'dead'):
            continue
        found, state = read_board(board, search, fetch)
        entry.update({'last_read': stamp, 'jobs': len(found), 'countries': board.get('countries') or [], 'kinds': board.get('kinds') or []})
        entry['misses'] = 0 if found else entry.get('misses', 0) + 1
        entry['state'] = 'browser' if state == 'browser' else 'dead' if entry['misses'] >= DEAD_AFTER else 'ok' if found else 'empty'
        print(f"Job boards found: {board['name']} {len(found)} job(s){'' if state != 'browser' else ' (refuses automated reading: offered as a visit)'}", flush=True)
        jobs.extend(found)
    board_ideas.save(data)
    return jobs
