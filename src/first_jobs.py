"""First jobs in seconds (spec docs/superpowers/specs/2026-10-16-first-jobs-fast.md): before a search's full crawl, read a small slice of fast feeds,
score 3 jobs at once and save (and sync) each as it is scored, so a new user's list has its first job while the rest of the search runs.
The search after it is unchanged; scored jobs are skipped by their hash, so the total AI calls are the same. Tests: tests/test_first_jobs.py."""
import time

from . import store
from .ai import score
from .sources import ats, feeds

SLICE = 15     # feeds read first
FIRST_JOBS = 3  # jobs scored first, at once
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


def run(db, feed_db, sources, profile, hidden, sync, say=print, scan=None, scorer=None, model=None, size=SLICE, first=FIRST_JOBS):
    """Read `size` feeds, import what matches, score `first` jobs (best places first) with a sync after every score. -> how many were scored.
    A failure here never blocks the search: the full run that follows does everything the slice did."""
    started = time.monotonic()
    scan, scorer, model = scan or feeds.scan, scorer or score.run, model or score.DEFAULT_MODEL
    chosen = pick(sources, size)
    say(f'First jobs: reading {len(chosen)} of {len(sources)} employer sites first')
    report = scan(chosen, feed_db)
    store.import_watch_report(db, report)
    say(f'First jobs: {len(report.get("jobs") or [])} found')   # the app reads the list again on this line
    from . import time_budget
    waiting = time_budget.best_first(score.queue(db, to_score(db, hidden), profile))
    ids = {job['id'] for job in waiting[:first]}
    if not ids:
        say(f'First jobs: {len(report.get("jobs") or [])} found, none to score yet')
        return 0
    stats = {}
    scorer(db, to_score(db, hidden), profile, model, first, workers=first, stats=stats, on_scored=sync, every=1, only_ids=ids)
    done = stats.get('done') or 0
    say(f'First jobs: {done} scored in {round(time.monotonic() - started)} s; the full search goes on')
    return done

