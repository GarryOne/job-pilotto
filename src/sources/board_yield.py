"""What a job board is worth to this search: the jobs it gave that are relevant (a title the search wants, in a place it wants), not the jobs it
lists (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md, PR 2). A board is dropped after 3 reads with none; untried boards are
read up to 3 a run while fewer than 10 relevant jobs are found; the 'Searching job boards' step reads the found boards in any country.
Tests: tests/test_board_yield.py."""
from datetime import date

DEAD_AFTER = 3         # reads with no relevant job (a StepStone banner counted as 2 jobs before)
ENOUGH = 10            # relevant jobs in the user's places: from here no untried board is read
MAX_UNTRIED = 3        # untried boards read in one run while relevant jobs are fewer than ENOUGH


def is_relevant(jobs):
    """The jobs whose title the search wants and whose place is one of the user's (the same judges as every source: the AI title and place
    triage first, then the role and place words)."""
    from . import feeds
    jobs = list(jobs)
    try:
        feeds.triage_places(jobs)
        feeds.triage(jobs)
    except Exception:  # noqa: BLE001 — the role and place words decide
        pass
    return [job for job in jobs if feeds.wanted_title(job.get('title')) and feeds.wanted_location(job)]


def record(entry, listed, relevant, state):
    """Keep one read in the board's entry: jobs listed, relevant jobs, reads in a row with none ('misses') and the state."""
    entry.update({'jobs': listed, 'relevant': relevant, 'last_yield': date.today().isoformat()})
    entry['misses'] = 0 if relevant else entry.get('misses', 0) + 1
    entry['state'] = 'browser' if state == 'browser' else 'dead' if entry['misses'] >= DEAD_AFTER else 'ok' if relevant else 'empty'


def total_relevant(kept):
    return sum(int(entry.get('relevant') or 0) for entry in kept.values() if entry.get('state') not in ('browser', 'dead'))


def pick(boards, kept, retry_due=lambda entry: False):
    """The boards to read now: every one read before (not dropped; a 'browser' one once its retry is due), then up to MAX_UNTRIED not read yet, only while the relevant jobs of
    the boards already read are fewer than ENOUGH."""
    tried, untried = [], []
    for board in boards:
        entry = kept.get(board['host'])
        if entry and (entry.get('state') == 'dead' or (entry.get('state') == 'browser' and not retry_due(entry))):
            continue
        (tried if entry and entry.get('last_read') else untried).append(board)
    return tried + (untried[:MAX_UNTRIED] if total_relevant(kept) < ENOUGH else [])


def step(search, is_relevant=is_relevant):
    """The 'Searching job boards' step for the found boards: reads them for any country and says in one line per board what it gave. Returns
    the sources lines (src/sources/boards.py main)."""
    from ..ai import board_ideas
    from . import found_boards
    found = board_ideas.ideas(search)
    if not found:
        print('Job boards: no board found for these places and roles yet', flush=True)
        return []
    print('Job boards: ' + ', '.join(board['name'] for board in found), flush=True)
    before = {host: entry.get('last_read') for host, entry in (board_ideas.load().get('boards') or {}).items()}
    found_boards.read(search, found, is_relevant=is_relevant)
    kept, out = board_ideas.load().get('boards') or {}, []
    for board in found:
        entry = kept.get(board['host']) or {}
        if not entry.get('last_read') or entry['last_read'] == before.get(board['host']):
            continue   # not read this time (dropped, or an untried board over the cap)
        out.append({'source': board['name'], 'status': 'refuses automated reading: offered as a visit' if entry.get('state') == 'browser'
                    else f"{entry.get('jobs', 0)} listed, {entry.get('relevant', 0)} relevant (your roles, your places)"})
    return out
