"""Counts the steps this install skipped because the shared pool already had the answer (a place word placed by another install), kept in data/pool_served.json.
Local only for now: the number the owner asked for ("steps skipped thanks to other installs"). Tests: tests/test_places.py (SharedPlaceTests)."""
import json
import threading

from .paths import DATA

STORE = DATA / 'pool_served.json'
LOCK = threading.Lock()


def load():
    try:
        data = json.loads(STORE.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def count(kind, n=1):
    """One more (or n more) steps of this kind served from the pool."""
    with LOCK:
        data = load()
        data[kind] = int(data.get(kind) or 0) + n
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps(data, sort_keys=True))
