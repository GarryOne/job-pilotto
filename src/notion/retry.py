"""Which failed Notion requests may be sent again: one table, statuses × kinds of request (Tracker._request in src/notion/client.py;
tests/test_notion_retry.py tests every cell).

- 429 (busy): Notion did nothing, so every request is sent again after the wait.
- 502/503/504 and Cloudflare's 520/522/524 (down, or the answer was lost): the request may have been done. Sent again only when that
  can't leave a second copy: a read, a query, a search, a property update or archive. A new page only once its database is known not to
  hold it: looked up by its Job URL (Job Tracker, Job Matches) and returned if Notion made it anyway. Appended blocks, a page with no Job
  URL and anything else fail at once, and the caller's own recovery takes over (a Move to Notion goes on where it stopped).
9 Oct 2026: a 520 on POST pages stopped a Move to Notion; 502-504 were then retried for every request, so a page could be made twice.
"""

BUSY = {429}
MAYBE_DONE = {502, 503, 504, 520, 522, 524}
RETRY, LOOKUP, FAIL = 'retry', 'look up, then retry', 'fail'
# Kinds of request: 'safe' (sending it twice changes nothing), 'create' (POST pages), 'append' (PATCH blocks/…/children), 'other'.
TABLE = {
    'busy': {'safe': RETRY, 'create': RETRY, 'append': RETRY, 'other': RETRY},
    'maybe done': {'safe': RETRY, 'create': LOOKUP, 'append': FAIL, 'other': FAIL},
}


def kind(method, path):
    if method in ('GET', 'DELETE'):
        return 'safe'
    if method == 'POST':
        return 'create' if path == 'pages' else 'safe' if path == 'search' or path.endswith('/query') else 'other'
    if method == 'PATCH':
        if path.startswith('blocks/') and path.endswith('/children'):
            return 'append'
        return 'safe' if path.startswith(('pages/', 'blocks/', 'databases/')) else 'other'
    return 'other'


def action(status, method, path):
    """RETRY, LOOKUP or FAIL for a request Notion answered with `status`."""
    family = 'busy' if status in BUSY else 'maybe done' if status in MAYBE_DONE else None
    return TABLE[family][kind(method, path)] if family else FAIL


def made_already(tracker, body):
    """For a new page whose answer was lost: the page if its database holds one with its Job URL, False if it holds none (safe to
    create), None when there is no key to check (not safe)."""
    database = ((body or {}).get('parent') or {}).get('database_id')
    url = (((body or {}).get('properties') or {}).get('Job URL') or {}).get('url')
    if not database or not url:
        return None
    found = tracker._query({'property': 'Job URL', 'url': {'equals': url}}, database)
    return found[0] if found else False
