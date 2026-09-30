"""One Job Matches row per job: find rows that are the same job (same URL, ignoring tracking parameters, a
trailing slash or the host's case) and keep the one with the most information; the others go to Notion's trash
(restorable for 30 days). Used by the sync (it heals itself when it meets duplicates)."""
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING = ('utm_', 'gh_src', 'gh_jid_src', 'ref', 'source', 'src', 'lever-source', 'trk', 'fbclid', 'gclid')
# Which row wins: the one that records a decision (Applied, Dismissed), then an open job, then the most recently scored.
STATUS_RANK = {'Applied': 5, 'Dismissed': 4, 'Open': 3, 'Not seen': 2, 'Closed': 1}


IDENTIFYING_FRAGMENT = re.compile(r'/|^jp-|[0-9a-f]{12,}', re.I)


def normalize_url(url):
    """The same job's URL, whatever tracking parameters, trailing slash or host case it came with."""
    parts = urlsplit((url or '').strip())
    if not parts.scheme:
        return (url or '').strip()
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not k.lower().startswith(TRACKING)]
    # A fragment is usually an in-page anchor (#apply), but some links are only told apart by it: an email
    # (mail.google.com/…/#all/<id>), a recruiter lead (…#jp-<digest>), a hash-routed board (#/jobs/123).
    fragment = parts.fragment if IDENTIFYING_FRAGMENT.search(parts.fragment) else ''
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/') or '/', urlencode(sorted(query)), fragment))


def _url(page):
    return ((page['properties'].get('Job URL') or {}).get('url') or '').strip()


def _status(page):
    return ((page['properties'].get('Status') or {}).get('select') or {}).get('name')


def _scored(page):
    return (((page['properties'].get('Scored') or {}).get('date') or {}).get('start')) or ''


def keeper(pages):
    """The row to keep among copies of one job, and why."""
    best = max(pages, key=lambda p: (STATUS_RANK.get(_status(p), 0), _scored(p), p.get('last_edited_time', '')))
    others = [p for p in pages if p is not best]
    if any(STATUS_RANK.get(_status(p), 0) < STATUS_RANK.get(_status(best), 0) for p in others):
        why = f'its status is {_status(best)}'
    elif any(_scored(p) < _scored(best) for p in others):
        why = f'scored most recently ({_scored(best)})'
    else:
        why = 'edited most recently'
    return best, why


def plan(pages):
    """[{url, keep, drop: [...], why}] for every job with more than one row (pages: Job Matches rows)."""
    groups = {}
    for page in pages:
        if _url(page):
            groups.setdefault(normalize_url(_url(page)), []).append(page)
    out = []
    for key, copies in groups.items():
        if len(copies) > 1:
            keep, why = keeper(copies)
            out.append({'url': _url(keep), 'keep': keep, 'drop': [p for p in copies if p is not keep], 'why': why})
    return sorted(out, key=lambda g: g['url'])
