"""Whether an install's scout needs to find new employer names (owner, 20 Oct 2026: "Central + Mac only when thin"): the central scout finds
employers for every kind of work across Europe every 6 hours; an install adds names only where that shared list is thin for its own search.
Covered = the downloaded employer list (src/employer_index.py) has at least scout_cells.FLOOR employers that mostly hire for one of the
search's kinds of work (role_kinds.of_search) with a job in the search's places. Then the install checks only the names the person added.
Tests: tests/test_scout_when_thin.py."""
from . import employer_index, role_kinds, scout_cells
from .paths import load_search_config


def covered(search=None, cache=None):
    """How many employers the shared list already has for this search, when at least FLOOR; None when the scout should look for more
    (kinds of work not known yet, no list downloaded, or too few)."""
    from .sources import feeds
    kinds = role_kinds.of_search(search if search is not None else load_search_config())
    index = employer_index._read(cache or employer_index.CACHE)
    if not kinds or not index or not index['feeds']:
        return None
    have = sum(1 for feed in index['feeds'] if scout_cells.top_kind(feed) in kinds
               and any(feeds.wanted_location({'location': place}) for place in feed.get('places') or []))
    return have if have >= scout_cells.FLOOR else None
