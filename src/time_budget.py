"""A refresh's time budget (owner, 7 Oct 2026: "never more than 2-3 minutes"; a run read 1,650 jobs and sorted 600 titles for 30 minutes).
`start(seconds)` at the top of a run. Each AI step then takes a batch it can finish (`batch`): its share of the time left divided by its own
pace, measured on this computer by earlier refreshes (`record`), best places first (owner: "not a hard cut, a batch that is reasonably small").
What is not in the batch waits for the next refresh, said in the log. `over()` stays as a safety net for a slow day: a step starts no new
call past the deadline (a call already running finishes). No budget (a CLI run, a cloud run, a test): every step takes all it has."""
import json
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


# Each step's share of the time left when it starts: title sorting least (a backlog that shrinks to a few dozen titles a day), scoring all
# that remains (it puts jobs in your list with a fit). Default paces (seconds of wall time per item, Claude Code taking 2 calls at a time):
# measured on the owner's Mac, 7 Oct 2026; replaced by this computer's own after one refresh.
SHARE = {'titles': 0.2, 'enrich': 0.45, 'score': 1.0}
PACE = {'titles': 1.8, 'enrich': 12.0, 'score': 3.0}
NOUN = {'titles': 'title(s)', 'enrich': 'job(s) to read', 'score': 'job(s) to score'}
WORDS = {'titles': 'sorts {n} of {total} job titles', 'enrich': 'reads {n} of {total} new jobs', 'score': 'scores {n} of {total} jobs'}


def _paces():
    from .paths import DATA
    try:
        return {**PACE, **json.loads((DATA / 'step_pace.json').read_text())}
    except (OSError, ValueError):
        return dict(PACE)


def batch(step, wanted, now=None):
    """How many of `wanted` items this step takes so the refresh ends on time: its share of the time left, at its measured pace. Says the
    plan in the log when it takes fewer. Without a budget: all of them."""
    if DEADLINE is None or wanted <= 0:
        return wanted
    left = DEADLINE - (now if now is not None else time.monotonic())
    pace = max(0.5, _paces().get(step, PACE[step]))
    n = max(0, min(wanted, int(left * SHARE[step] / pace)))
    if not n:
        print(f'⏱ No time left in this refresh to {WORDS[step].split(" ", 1)[0].rstrip("s")} any: {wanted} {NOUN[step]} wait for the next one', flush=True)
    elif n < wanted:
        print(f'⏱ This refresh {WORDS[step].format(n=n, total=wanted)} (about {round(pace, 1):g} s each, to finish in about '
              f'{round((DEADLINE - STARTED) / 60, 1):g} min); {wanted - n} wait for the next refresh, best places first', flush=True)
    return n


def record(step, seconds, done):
    """This computer's pace for `step` (wall seconds per item), smoothed over refreshes, for the next one's batch."""
    if DEADLINE is None or done <= 0 or seconds <= 0:   # only a refresh with a budget measures (never a test or a one-off command)
        return
    from .paths import DATA
    paces = _paces()
    paces[step] = round(0.5 * paces.get(step, PACE[step]) + 0.5 * seconds / done, 2)
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / 'step_pace.json').write_text(json.dumps({k: paces[k] for k in PACE}))
    except OSError:
        pass


def left_line(step, left, noun='job(s)'):
    """The run's line for work left over: said once per step, so the user knows nothing was dropped."""
    return f'⏱ Time is up for this refresh: {left} {noun} left for the next one (it stops at {round((DEADLINE - STARTED) / 60, 1):g} min)'


def best_first(jobs):
    """Jobs in your best places first (Search settings "Best places"), the order kept otherwise: a short search spends its time on them."""
    from .paths import keyword_regex, load_search_config
    best = keyword_regex((load_search_config().get('locations') or {}).get('top_tier') or [r'(?!x)x'])
    return sorted(jobs, key=lambda job: 0 if best.search(job.get('location') or '') else 1)
