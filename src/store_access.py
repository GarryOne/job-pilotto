"""The run's store, light to import (the desktop commands and the scheduled search both use it): the active store opened once,
the Notion tracker only while that store is Notion, and the two reads every caller needs from it (application stages, the Profile).
Guarded by tests/test_daily_store.py and tests/test_desktop_store.py.
"""
from .paths import local_profile
from .stores import open_stores


def run_stores(tracker):
    """The run's one store: the tracker's Notion when the engine holds one (JOB_PILOTTO_STORE may still choose another), else the
    store the environment picks. And the Notion tracker for the steps only Notion has yet, None on any other store, so a person on
    this Mac's store never gets a second copy of their data in Notion."""
    stores = open_stores(tracker=tracker) if tracker else open_stores()
    return stores, (tracker if stores.name == 'notion' else None)


def url_stages(stores, notion):
    """Job URL (as stored) -> Stage of every application. Notion: the tracker's own read, unchanged; any other store: its records."""
    if notion:
        return notion.url_stages()
    return {record['url'].strip(): record['stage'] for record in stores.applications.list() if record.get('url')}


def profile_source(stores, notion):
    """What reads the Profile for scoring, or None when there is none: this Mac's profile.md, else the Notion page (read when used,
    as before), else the store's Profile text."""
    if local_profile():
        return local_profile
    if notion:
        return notion.page_text
    text = stores.texts.get('profile') or ''
    return (lambda: text) if text.strip() else None


_ENGINE = []   # the Notion clients open_run made (one per command)


def open_run():
    """The run's one store, opened once from the environment (src/daily.py): Notion through the client the engine has always made
    (Tracker.from_env: its Job Tracker, its pacing; None when Notion is switched off) when there is one, else what open_stores picks."""
    from .notion import client as notion
    tracker = notion.Tracker.from_env()
    if tracker is not None:
        _ENGINE.append(tracker)   # notion_of hands out this client only: the one the engine had before the store
    return run_stores(tracker)[0]


def notion_of(stores):
    """The engine's Notion client behind the run's store (open_run), for a step whose own lane hasn't moved it onto the store yet;
    None on any other store, and when Tracker.from_env gave none (no token, JOB_PILOTTO_DISABLE=notion): exactly when the engine had
    a tracker before. Every use carries a bridge marker naming its lane, and goes when that lane lands."""
    tracker = getattr(getattr(stores, 'applications', None), 'tracker', None) if stores is not None and stores.name == 'notion' else None
    return tracker if any(tracker is mine for mine in _ENGINE) else None
