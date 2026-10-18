"""First jobs in seconds (spec docs/superpowers/specs/2026-10-16-first-jobs-fast.md): before a search's full crawl, read a small slice of fast feeds,
score 3 jobs at once and save (and sync) each as it is scored, so a new user's list has its first job while the rest of the search runs;
while none of them fits 70+, 3 more, up to MAX_FIRST (owner, 18 Oct 2026: Cluj's slice found 70 jobs at 93 s, scored 3, and its first 70+
waited for the full crawl until 431 s). The 2 job boards that gave installs like this one the most jobs in their places are read in the
slice too (spec 2026-10-18-search-learns-sources.md PR 6); with none shared yet, the 4 first boards proposed for the user's country (one
cached AI call, the same the full read makes; owner, 18 Oct 2026: a driver's jobs all came from a board read after 140 employer sites),
read at once and while the employer sites are (18 Oct 2026: Chisinau's first 2 boards gave nothing; SRE's 70+ waited for 2 boards).
The search after it is unchanged; scored jobs are skipped by their hash, so the total AI calls are the same.
Tests: tests/test_first_jobs.py, tests/test_proven_boards.py."""
import os
import time
from concurrent.futures import ThreadPoolExecutor

from . import store
from .ai import score
from .sources import ats, feeds

SLICE = 15     # feeds read first
FIRST_JOBS = 3  # jobs scored first, at once
MAX_FIRST = 10  # scored at most in the slice while none fits FIT+ yet: the full search would score these same best-ranked jobs anyway
FIT = 70        # a strong match ends the slice's scoring (src/source_yield.py FIT)
SLICE_BOARDS = 4   # read at once (src/sources/found_boards.py BOARD_WORKERS)
FAST = ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'teamtailor', 'join')   # a JSON list in one request


def pick(sources, size=SLICE):
    """The feeds read first: the ones that answer in one request (fast kinds), then the others; each group in the list's own order
    (the index ranks it). A page read in Chrome belongs to one install's visits, not to this slice."""
    usable = [source for source in sources if source.get('ats', 'greenhouse') in ats.FETCHERS and source.get('ats') != 'visit']
    fast = [source for source in usable if source.get('ats', 'greenhouse') in FAST]
    return (fast + [source for source in usable if source not in fast])[:size]


def to_score(db, hidden):
    from .daily_helpers import to_score as eligible
    return eligible(db, hidden)


def proven_boards(feed_db, say=print, search=None):
    """The jobs (report shape) of the slice's boards (board_jobs), in your roles and places."""
    found = board_jobs(say, search)
    return aggregators_kept(feed_db, 'Job boards found', found) if found else []


def board_jobs(say=print, search=None):
    """The jobs (as read) of the job boards that gave installs like this one the most jobs in their places (no AI call: the pool's
    ranking, src/ai/board_ideas.py proven), else of the first boards proposed for this search's countries that never refused us; read now,
    and the full search's board read reuses the pages fetched here. Touches no job cache: it runs beside the employer sites' read."""
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR'):   # the end-to-end fixture mode never reaches a live site (as aggregators.scan)
        return []
    from .ai import board_ideas
    from .paths import load_search_config
    from .sources import found_boards
    search = search or load_search_config()
    top = board_ideas.proven(search, limit=SLICE_BOARDS)
    if top:
        say(f"First jobs: reading {', '.join(board['name'] for board in top)}, the job board{'s' if len(top) > 1 else ''} that gave people "
            'like you the most jobs')
    else:
        refused = {host for host, entry in (board_ideas.load().get('boards') or {}).items() if entry.get('state') == 'browser'}
        top = [board for board in board_ideas.ideas(search) if board.get('host') not in refused][:SLICE_BOARDS]
        if not top:
            return []
        say(f"First jobs: reading {', '.join(board['name'] for board in top)}, job board{'s' if len(top) > 1 else ''} for your country")
    return found_boards.read(search, top, early=True)


def aggregators_kept(feed_db, name, jobs):
    from .sources import aggregators
    return aggregators.kept(feed_db, name, jobs)


def scored_fits(db):
    """{job id: fit score} of the jobs scored so far."""
    from .source_yield import _fits
    try:
        return {str(job_id): fit for job_id, fit in _fits(db).items()}
    except Exception:  # noqa: BLE001 — unknown: the slice scores its next batch
        return {}


def run(db, feed_db, sources, profile, hidden, sync, say=print, scan=None, scorer=None, model=None, size=SLICE, first=FIRST_JOBS, boards=None,
        fits=None):
    """Read `size` feeds and, at the same time, the first boards (boards(say) -> their jobs as read), import what matches, score `first` jobs at a time (best first) with a sync after every score,
    until one fits FIT+ or MAX_FIRST are scored. -> how many were scored. A failure here never blocks the search: the full run that follows
    does everything the slice did."""
    started = time.monotonic()
    scan, scorer, model, fits = scan or feeds.scan, scorer or score.run, model or score.DEFAULT_MODEL, fits or scored_fits
    chosen = pick(sources, size)
    say(f'First jobs: reading {len(chosen)} of {len(sources)} employer sites first')
    with ThreadPoolExecutor(max_workers=1) as pool:
        reading = pool.submit(boards or board_jobs, say)   # the boards' pages meanwhile; matched below, in the thread that owns the job cache
        report = scan(chosen, feed_db)
        try:
            found = reading.result()
            report['jobs'] = [*(report.get('jobs') or []), *(aggregators_kept(feed_db, 'Job boards found', found) if found else [])]
        except Exception as error:  # noqa: BLE001 — the full search reads every board
            say(f'Warning: first job boards not read: {type(error).__name__}: {error}')
    store.import_watch_report(db, report)
    say(f'First jobs: {len(report.get("jobs") or [])} found')   # the app reads the list again on this line
    from . import time_budget
    order = [job['id'] for job in time_budget.best_first(score.queue(db, to_score(db, hidden), profile))][:MAX_FIRST]
    if not order:
        say(f'First jobs: {len(report.get("jobs") or [])} found, none to score yet')
        return 0
    done, tried, strong = 0, 0, False
    while tried < len(order) and not strong:
        ids = set(order[tried:tried + first])
        tried += len(ids)
        stats = {}
        scorer(db, to_score(db, hidden), profile, model, first, workers=first, stats=stats, on_scored=sync, every=1, only_ids=ids)
        if not stats.get('done'):   # a paused Profile, a spent limit or the time: the next batch would score nothing either
            break
        done += stats['done']
        strong = any(fit >= FIT for job_id, fit in fits(db).items() if job_id in {str(i) for i in ids})
    said = f', one fits {FIT}+' if strong else ''
    say(f'First jobs: {done} scored in {round(time.monotonic() - started)} s{said}; the full search goes on')
    return done
