"""A search's time budget (owner, 7 Oct 2026: "Search for new jobs will never take more than 2-3 minutes"; a run read 1,650 jobs and sorted 600
titles for 30 minutes). `start(seconds)` at the top of a run; each AI step asks `over(reserve)` before it starts another call, keeping `reserve`
seconds for the steps after it. A call already running finishes; what is not done waits for the next search, best places first. No budget
(None, a CLI run or a test): nothing stops early."""
import re
import time

DEADLINE = None
STARTED = None
RESERVE = {'titles': 75, 'enrich': 40, 'score': 0}   # seconds kept for the AI steps that come after this one


def start(seconds, now=None):
    global DEADLINE, STARTED
    STARTED = now if now is not None else time.monotonic()
    DEADLINE = STARTED + seconds if seconds else None


def over(step='score', now=None):
    """True when `step` must not start another AI call: the run's budget, minus what the later steps keep, is spent."""
    if DEADLINE is None:
        return False
    return (now if now is not None else time.monotonic()) >= DEADLINE - RESERVE.get(step, 0)


def left_line(step, left, noun='job(s)'):
    """The run's line for work left over: said once per step, so the user knows nothing was dropped."""
    return f'⏱ Time is up for this search: {left} {noun} left for the next one (the search stops at {round((DEADLINE - STARTED) / 60, 1):g} min)'


def best_first(jobs):
    """Jobs in your best places first (Search settings "Best places"), the order kept otherwise: a short search spends its time on them."""
    from .paths import keyword_regex, load_search_config
    best = keyword_regex((load_search_config().get('locations') or {}).get('top_tier') or [r'(?!x)x'])
    return sorted(jobs, key=lambda job: 0 if best.search(job.get('location') or '') else 1)
