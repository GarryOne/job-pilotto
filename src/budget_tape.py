"""The search tape's time-budget decisions: what `time_budget` decided at each point of a recorded search, kept beside the web and AI answers
and read back in a replay, so a replay takes the same path whatever the replaying computer's speed or thread timing (owner, 18 Oct 2026: two
replays of one tape disagreed, 35 vs 39 places and 67 vs 522 missing web answers, because a decision read a wall clock).
Off unless JOB_PILOTTO_SEARCH_TAPE is set; a live run never touches it. A decision the tape lacks (a changed search asks a new question) is
computed from the clock, as in a live run. Each process that starts a budget is the run's next search (new_search), so one tape holds every press. Same-key decisions are matched by their order (over() only ever flips false to true, so threads
asking at once still see the same number of false answers). Tests: tests/test_budget_tape.py."""
import json
import os
import threading
from pathlib import Path

_lock = threading.Lock()
_epoch = [0]    # which search of the run this process is (the 1st, 2nd... to call start()): one tape holds every press's processes
_seen = {}      # key -> decisions asked so far in this process (the position of the next one)
_tape = {}      # key -> [recorded values], read once per process


def _folder():
    folder = os.getenv('JOB_PILOTTO_SEARCH_TAPE')
    return Path(folder) if folder else None


def active():
    return _folder() is not None


def _mode():
    return os.getenv('JOB_PILOTTO_SEARCH_TAPE_MODE', 'replay')


def _load():
    if _tape:
        return _tape
    file = _folder() / 'budget.jsonl'
    for line in file.read_text().splitlines() if file.exists() else []:
        try:
            record = json.loads(line)
            _tape.setdefault(record['key'], []).append(record['value'])
        except (ValueError, KeyError):
            continue
    _tape.setdefault('', [])   # marks the tape as read (an empty file is read once)
    return _tape


def new_search():
    """A process starts its time budget: it is the run's next search. The count lives in the run's own data folder (fresh for each replay and
    each recording), so the same processes in the same order get the same numbers in both."""
    if not active():
        return
    from .paths import DATA
    file = DATA / 'budget_epoch.txt'
    try:
        epoch = int(file.read_text()) + 1
    except (OSError, ValueError):
        epoch = 1
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        file.write_text(str(epoch))
    except OSError:
        pass
    with _lock:
        _epoch[0] = epoch
        _seen.clear()


def decide(kind, args, compute):
    """The decision `kind(*args)`: from the tape in a replay (when it has this one), else `compute()`, kept in a recording."""
    if not active():
        return compute()
    key = json.dumps([_epoch[0], kind, *args], default=str)
    with _lock:
        position = _seen[key] = _seen.get(key, -1) + 1
        recorded = _load().get(key, [])
        if _mode() == 'replay' and position < len(recorded):
            return recorded[position]
    value = compute()
    if _mode() == 'record':
        with _lock:
            _folder().mkdir(parents=True, exist_ok=True)
            with open(_folder() / 'budget.jsonl', 'a', encoding='utf-8') as file:
                file.write(json.dumps({'key': key, 'value': value}) + '\n')
    return value
