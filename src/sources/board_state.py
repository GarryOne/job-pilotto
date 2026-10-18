"""Jobs a board's page ships as JSON state inside the page (a script tag of type application/json, or a `window.NAME = {...}` assignment),
for pages whose cards are drawn by scripts. Found by the shape of the data, never by a site's name: a list of records that each carry a title,
a link and at least two more fields (employer, place, date ...); a menu or a list of categories has too few fields to count. Plain data in,
jobs out: no AI, no network (the page is already fetched). Tests: tests/test_board_state.py."""
import json
import re
import urllib.parse

MAX_SCAN = 3_000_000   # characters of a page looked at
MAX_BLOBS = 8          # JSON blobs parsed per page
MAX_NODES = 60_000     # values walked per blob
MIN_RECORDS = 3        # a list shorter than this is not a result list
MIN_FIELDS = 4         # title, link and two more
MAX_JOBS = 200
_ASSIGN = re.compile(r'window\s*(?:\.\s*|\[\s*[\'"])[\w$]+(?:[\'"]\s*\])?\s*=\s*(?=[\[{])')
_TAG = re.compile(r'<script\b[^>]*type=["\']application/json["\'][^>]*>(.*?)</script>', re.I | re.S)


def _blobs(page):
    page = page[:MAX_SCAN]
    decoder = json.JSONDecoder()
    found = [m.group(1) for m in _TAG.finditer(page)]
    for m in _ASSIGN.finditer(page):
        found.append(page[m.end():])
    out = []
    for text in found[:MAX_BLOBS * 3]:
        try:
            out.append(decoder.raw_decode(text.lstrip())[0])
        except ValueError:
            continue
        if len(out) >= MAX_BLOBS:
            break
    return out


def _lists(value):
    """Every list of dicts in the value, with a node budget."""
    budget, stack = [MAX_NODES], [value]
    while stack and budget[0] > 0:
        node = stack.pop()
        budget[0] -= 1
        if isinstance(node, list):
            if len(node) >= MIN_RECORDS and all(isinstance(x, dict) for x in node[:MIN_RECORDS]):
                yield node
            stack.extend(x for x in node[:MAX_JOBS * 2] if isinstance(x, (dict, list)))
        elif isinstance(node, dict):
            stack.extend(x for x in node.values() if isinstance(x, (dict, list)))


def _flat(record):
    """{'key': text} of the record's scalar fields, one level of nested records included as 'outer.inner'."""
    fields = {}
    for key, value in record.items():
        if isinstance(value, (str, int, float)) and not isinstance(value, bool) and str(value).strip():
            fields[str(key)] = str(value).strip()
        elif isinstance(value, dict):
            for inner, deep in value.items():
                if isinstance(deep, (str, int, float)) and not isinstance(deep, bool) and str(deep).strip():
                    fields[f'{key}.{inner}'] = str(deep).strip()
    return fields


def _pick(fields, *hints, link=False):
    for hint in hints:
        for key, value in fields.items():
            if hint in key.lower() and (not link or re.match(r'(https?://|/)\S+$', value)):
                return value
    return ''


def _record(fields, base):
    if len(fields) < MIN_FIELDS:
        return None
    address = _pick(fields, 'url', 'link', 'href', link=True) or next((v for v in fields.values() if re.match(r'(https?://|/)[^\s/]+/\S+$', v)), '')
    title = _pick(fields, 'title') or _pick(fields, 'position', 'name')
    url = urllib.parse.urljoin(base, address) if address else ''
    if not title or not url.startswith('http') or title == address or len(title) > 200:
        return None
    return {'title': title, 'url': url, 'company': _pick(fields, 'company', 'employer', 'organi'), 'location': _pick(fields, 'locat', 'city', 'place'),
            'posted': _pick(fields, 'posted', 'date'), 'description': _pick(fields, 'descr', 'summary', 'snippet')}


def records(page, base):
    """The records of the best result list in the page: the list with the most records that each carry title, link and more fields."""
    best = []
    for blob in _blobs(page):
        for rows in _lists(blob):
            got = [r for r in (_record(_flat(row), base) for row in rows[:MAX_JOBS]) if r]
            if len(got) >= MIN_RECORDS and len(got) >= 0.8 * len(rows[:MAX_JOBS]) and len(got) > len(best):
                best = got
    return list({r['url']: r for r in best}.values())


def jobs(page, base, board):
    """Jobs in the aggregators' shape from the page's embedded state; [] when it has no result list."""
    from .aggregators import _job
    return [_job(board['host'], r['url'], r['title'], r['company'] or f"via {board['name']}", r['location'], r['url'], r['posted'][:10], r['description'])
            for r in records(page, base)]
