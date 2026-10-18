"""Readers that run side by side batch only their own jobs: while they do, each sees the places and titles decided as they were when the scope began,
plus its own answers, never what another reader decided meanwhile (18 Oct 2026, Lab measurements: the first-jobs slice reads the employer sites and
the boards at once; whichever finished first left the other a shorter batch, so a replay in the other order asked batches the tape never held and
missed ~30 requests). Outside a scope nothing changes: every call sees the store as it is. Cost: a new place or title that two side-by-side
readers share is asked by both, once, in that scope; afterwards it is stored. Used by place_triage, title_triage, geo and feeds (what they `watch`),
opened by src/first_jobs.py. Tests: tests/test_triage_batch_order.py."""
import contextlib
import copy
import threading

_WATCHED = {}    # topic -> (load, merge): what a reader sees, and how its own answers join the shared copy when it ends
_frozen = None   # {topic: the value when the scope began}, None outside a scope
_by_reader = {}  # reader name -> {topic: its private copy}, kept while the scope lasts so a reader asks nothing twice
_local = threading.local()


def watch(topic, load, merge=None):
    _WATCHED[topic] = (load, merge)


def active():
    return _frozen is not None and getattr(_local, 'views', None) is not None


def view(topic, load):
    """The value of `topic` for the calling reader: its private copy inside a scope, else load()'s own."""
    if not active():
        return load()
    views = _local.views
    if topic not in views:
        views[topic] = copy.deepcopy(_frozen[topic]) if topic in _frozen else load()
    return views[topic]


@contextlib.contextmanager
def concurrent():
    """Readers started inside see the world as it is now (plus their own answers)."""
    global _frozen
    if _frozen is not None:
        yield
        return
    from .. import geo  # noqa: F401 — importing registers what each module watches
    from ..sources import feeds  # noqa: F401
    from . import place_triage, title_triage  # noqa: F401
    snapshot = {topic: copy.deepcopy(load()) for topic, (load, _) in list(_WATCHED.items())}
    _by_reader.clear()
    _frozen = snapshot
    try:
        yield
    finally:
        _frozen = None
        _by_reader.clear()


@contextlib.contextmanager
def reader(name):
    """One reader's calls in this thread: its answers stay its own until it ends, then join the shared copies."""
    if _frozen is None:
        yield
        return
    views = _by_reader.setdefault(name, {})
    _local.views = views
    try:
        yield
    finally:
        _local.views = None
        for topic, value in list(views.items()):
            merge = _WATCHED.get(topic, (None, None))[1]
            if merge:
                merge(value)
