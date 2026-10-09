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
