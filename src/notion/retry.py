"""Which failed Notion requests may be sent again: one table, statuses × kinds of request (Tracker._request in src/notion/client.py;
tests/test_notion_retry.py tests every cell).

- 429 (busy): Notion did nothing, so every request is sent again after the wait.
- 502/503/504 (briefly down): sent again as they always were (D7: Notion users see no change), except a new page with a Job URL, which is
  first looked up in its database and returned if Notion made it anyway (Job Tracker, Job Matches: never made twice).
- Cloudflare's 520/522/524 (the answer was lost; never retried before): a read, a query, a search, a property update or archive is sent
  again; a new page only after that Job URL lookup; appended blocks, a page with no Job URL and anything else fail as before.
9 Oct 2026: a 520 on POST pages stopped a Move to Notion (mac-e4 chose the 502-504 cells: keep today's retries, add the lookup).
"""

BUSY = {429}
DOWN = {502, 503, 504}
EDGE = {520, 522, 524}
# LOOKUP: a new page with a Job URL is looked up first; with none, LOOKUP fails and LOOKUP_OR_RETRY sends it again as before.
RETRY, LOOKUP, LOOKUP_OR_RETRY, FAIL = 'retry', 'look up, else fail', 'look up, else retry', 'fail'
# Kinds of request: 'safe' (sending it twice changes nothing), 'create' (POST pages), 'append' (PATCH blocks/…/children), 'other'.
TABLE = {
    'busy': {'safe': RETRY, 'create': RETRY, 'append': RETRY, 'other': RETRY},
    'down': {'safe': RETRY, 'create': LOOKUP_OR_RETRY, 'append': RETRY, 'other': RETRY},
    'edge': {'safe': RETRY, 'create': LOOKUP, 'append': FAIL, 'other': FAIL},
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
    """RETRY, LOOKUP, LOOKUP_OR_RETRY or FAIL for a request Notion answered with `status`."""
    family = 'busy' if status in BUSY else 'down' if status in DOWN else 'edge' if status in EDGE else None
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
