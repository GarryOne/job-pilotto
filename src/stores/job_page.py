"""One job's drawer page in one store call (`python -m src.stores call job_page read`): its sections, events and interviews read together,
in threads, with each GET (the page's block list above all) made once instead of once per call. Only for a single short run: nothing is kept
after it. Guarded by tests/test_job_page_read.py."""
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager


@contextmanager
def read_once(trackers):
    """For the block: a GET to the same path on a tracker returns the first answer (others are passed through)."""
    seen, lock, undo = {}, threading.Lock(), []
    for tracker in trackers:
        real = tracker._request

        def memo(method, path, body=None, _real=real, _id=id(tracker)):
            if method != 'GET':
                return _real(method, path, body)
            with lock:
                entry = seen.setdefault((_id, path), [threading.Lock(), None, False])
            with entry[0]:
                if not entry[2]:
                    entry[1], entry[2] = _real(method, path, body), True
            return entry[1]
        tracker._request = memo
        undo.append((tracker, real))
    try:
        yield
    finally:
        for tracker, real in undo:
            tracker._request = real


def read(stores, app_id):
    """{sections, events, interviews} of the job with this application id."""
    app_id = str(app_id)
    trackers = []
    for part in (stores.applications, stores.events, stores.interviews):
        tracker = getattr(part, 'tracker', None)
        if tracker is not None and all(tracker is not other for other in trackers):
            trackers.append(tracker)
    if not trackers:   # no Notion client: a local store (SQLite's connection refuses another thread; there is no network GET to overlap)
        return {'sections': stores.applications.sections(app_id), 'events': stores.events.list(app_id=app_id), 'interviews': stores.interviews.list(app_id=app_id)}
    with read_once(trackers), ThreadPoolExecutor(3) as pool:
        sections = pool.submit(stores.applications.sections, app_id)
        events = pool.submit(stores.events.list, app_id=app_id)
        interviews = pool.submit(stores.interviews.list, app_id=app_id)
        return {'sections': sections.result(), 'events': events.result(), 'interviews': interviews.result()}
