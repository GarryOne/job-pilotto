"""Which failed Notion requests may be sent again (Tracker._request in src/notion/client.py; tests/test_notion_retry.py).

429 and 502/503/504 are retried as they always were. Cloudflare's 520/522/524 (Notion's edge lost the answer: the request may or may
not have been done) are retried only when doing it twice changes nothing (a read, a query, a property update, an archive), and a new
page only once the database is known not to hold it yet: looked up by its Job URL (Job Tracker, Job Matches), so a row is never made
twice (9 Oct 2026: a 520 on POST pages stopped a "Move to Notion"). A page with no Job URL, or appended blocks, fail as before.
"""

CLOUDFLARE = {520, 522, 524}


def safe_again(method, path):
    """True when sending this request a second time can't leave a second copy of anything."""
    if method in ('GET', 'DELETE'):
        return True
    if method == 'POST':
        return path == 'search' or path.endswith('/query')
    if method == 'PATCH':   # a page's properties or its archive flag; appending children (blocks/…/children) is not
        return path.startswith('pages/') or (path.startswith('blocks/') and not path.endswith('/children'))
    return False


def made_already(tracker, body):
    """For a POST pages that failed with a Cloudflare error: the page if the database holds one with its Job URL, False if it holds
    none (safe to create), None when there is no key to check (not safe)."""
    database = ((body or {}).get('parent') or {}).get('database_id')
    url = (((body or {}).get('properties') or {}).get('Job URL') or {}).get('url')
    if not database or not url:
        return None
    found = tracker._query({'property': 'Job URL', 'url': {'equals': url}}, database)
    return found[0] if found else False
