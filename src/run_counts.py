"""This search's own numbers (jobs looked at, matches, scored), each job counted once by its URL, printed as one structured line the Find jobs card reads."""
import threading

PREFIX = 'Run counts: '
_lock = threading.Lock()
_sets = {'looked': set(), 'matches': set(), 'scored': set()}


def reset():
    with _lock:
        for seen in _sets.values():
            seen.clear()


def line():
    return f"{PREFIX}looked={len(_sets['looked'])} matches={len(_sets['matches'])} scored={len(_sets['scored'])}"


def _add(kind, keys):
    with _lock:
        seen = _sets[kind]
        before = len(seen)
        seen.update(str(key).strip() for key in keys if key)
        if kind != 'looked':
            _sets['looked'].update(str(key).strip() for key in keys if key and kind == 'matches')   # a match was looked at
        changed = len(seen) != before
        if changed:
            print(line(), flush=True)   # the card shows the latest one (desktop/renderer/find-card-model.js runCounts)


def looked(jobs):
    _add('looked', [job.get('url') or job.get('id') for job in jobs])


def matched(jobs):
    _add('matches', [job.get('url') or job.get('id') for job in jobs])


def scored(job):
    _add('scored', [job.get('url') or job.get('id')])
