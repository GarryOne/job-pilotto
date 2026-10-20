"""Each site read at the pace it allows (owner, 20 Oct 2026: "read slower to avoid this too many requests", "detect and adapt to each
site/platform automatically"). Every engine reader of a public site opens its requests here (`open`), or asks for its turn (`turn`) and
reports the answer (`answer`) when it fetches another way (the headless browser).

- 401/403 are refusals (REFUSED), exactly as before: never retried, never worked around.
- 429, and 503 with a Retry-After, mean "slow down", never "refused": the site's gap doubles (at least its Retry-After), the request waits
  and is tried again up to RETRIES times in the run; past MAX_WAIT it raises Busy (an OSError, so a reader's "failed, try later" path takes
  it) and the job waits for the next run. Before 20 Oct 2026 one 429 parked a whole shared job-system host for 7 days.
- After SPEEDUP_AFTER answers in a row without a slow-down, the gap shrinks by SPEEDUP, never below START_GAP.
- One pace per registrable domain (careers_parse.registrable): every employer on a shared job system shares it, since the limit is on our address.
- What was learned (gap, calm-until) is kept in data/host_pace.json, only numbers per domain, so the next run starts at it.
Tests: tests/test_host_pace.py (fake local server, every reader in the class).
"""
import email.utils
import ipaddress
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

REFUSED = (401, 403)      # a refusal: respected, never retried
SLOW = (429, 503)         # "slow down" (503 only with a Retry-After)
START_GAP = 0.2           # seconds between two requests to one domain that never asked us to slow down
MAX_GAP = 120.0
SPEEDUP_AFTER = 10
SPEEDUP = 0.8
RETRIES = 3               # tries again in the same run after a slow-down
MAX_WAIT = 60.0           # longer than this and the request waits for the next run (Busy)
KEEP_DAYS = 30            # a learned pace older than this is forgotten

clock = time.time   # tests set a fake clock and sleep, so waits don't depend on the machine
sleep = time.sleep
FILE = None         # tests point it at a temp file; else data/host_pace.json

_lock = threading.Lock()
_state = None       # domain -> {'gap', 'calm', 'ok', 'at'}; 'next' (the next free slot) lives only in this process


class Busy(OSError):
    """The site asked us to slow down for longer than this run waits: try it in a later run. Not a refusal."""

    def __init__(self, url, until):
        super().__init__(f'{domain(url)} asked us to slow down until {time.strftime("%H:%M", time.localtime(until))}')
        self.url, self.until = url, until


def domain(url):
    from .careers_parse import registrable
    host = urllib.parse.urlsplit(url if '//' in str(url) else f'https://{url}').hostname or ''
    try:
        return str(ipaddress.ip_address(host))   # an address has no domain: itself
    except ValueError:
        return registrable(host)


def _file():
    if FILE:
        return FILE
    from ..paths import DATA
    return DATA / 'host_pace.json'


def _load():
    global _state
    if _state is None:
        try:
            kept = json.loads(_file().read_text())
        except (OSError, ValueError):
            kept = {}
        since = clock() - KEEP_DAYS * 86400
        _state = {key: {'gap': float(line.get('gap') or START_GAP), 'calm': float(line.get('calm') or 0), 'ok': 0, 'at': float(line.get('at') or 0)}
                  for key, line in (kept.items() if isinstance(kept, dict) else []) if isinstance(line, dict) and float(line.get('at') or 0) >= since}
    return _state


def _save(state):
    learned = {key: {'gap': round(line['gap'], 2), 'calm': round(line['calm']), 'at': round(line['at'])} for key, line in state.items()
               if line['gap'] > START_GAP or line['calm'] > clock()}
    try:
        path = _file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(learned, indent=1, sort_keys=True) + '\n')
    except OSError:
        pass   # the pace is still kept for this run


def _line(state, key):
    return state.setdefault(key, {'gap': START_GAP, 'calm': 0.0, 'ok': 0, 'at': clock()})


def waiting(url):
    """When this site lets us ask again (epoch seconds), or 0 when it never asked us to slow down."""
    with _lock:
        calm = _load().get(domain(url), {}).get('calm', 0)
    return calm if calm > clock() else 0


def turn(url):
    """Wait for this domain's next slot; Busy when the site asked to slow down for longer than MAX_WAIT."""
    key = domain(url)
    with _lock:
        line = _line(_load(), key)
        now = clock()
        if line['calm'] - now > MAX_WAIT:
            raise Busy(url, line['calm'])
        at = max(line.get('next', 0), line['calm'], now)
        line['next'] = at + line['gap']
    if at > now:
        sleep(at - now)


def retry_after(headers):
    """Seconds from a Retry-After header (a number or an HTTP date); None when absent or unreadable."""
    value = str((headers or {}).get('Retry-After') or '').strip()
    if not value:
        return None
    if value.isdigit():
        return float(value)
    try:
        return max(0.0, email.utils.parsedate_to_datetime(value).timestamp() - clock())
    except (TypeError, ValueError, IndexError):
        return None


def answer(url, status, wait=None):
    """What the site answered. A slow-down (429, or 503 with a Retry-After) widens its gap; a run of good answers narrows it.
    True when it was a slow-down."""
    slow = status == 429 or (status == 503 and wait is not None)
    key = domain(url)
    with _lock:
        state = _load()
        line = _line(state, key)
        now = clock()
        line['at'] = now
        if slow:
            line['gap'] = min(MAX_GAP, max(line['gap'] * 2, 1.0, wait or 0))
            line['calm'] = max(line['calm'], now + max(wait or 0, line['gap']))
            line['ok'] = 0
            _save(state)
        elif status < 400:
            line['ok'] += 1
            if line['ok'] >= SPEEDUP_AFTER and line['gap'] > START_GAP:
                line['gap'], line['ok'] = max(START_GAP, line['gap'] * SPEEDUP), 0
                _save(state)
    return slow


def open(request, timeout=15, opener=None):  # noqa: A001 — the readers' urlopen
    """urllib.request.urlopen at the site's pace: waits its turn, retries a slow-down, raises Busy when the site needs longer."""
    url = request.full_url if isinstance(request, urllib.request.Request) else str(request)
    for attempt in range(RETRIES + 1):
        turn(url)
        try:
            response = (opener or urllib.request.urlopen)(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            if not answer(url, error.code, retry_after(error.headers)):
                raise
            if attempt == RETRIES:
                raise Busy(url, max(waiting(url), clock())) from error
            continue
        answer(url, getattr(response, 'status', None) or 200)
        return response


def reset():
    """Forget the in-process state (tests)."""
    global _state
    with _lock:
        _state = None
