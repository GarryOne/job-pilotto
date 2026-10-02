"""The central employer index: feeds found and verified by one scout for everyone, downloaded by every install.

Nothing about the user goes up: a plain GET with a random install id and the token the website gives that id
(the full list is not a public download; the website's own counters use a separate public summary). The result
is cached on disk and fetched at most once a day; if the service is down the cache is used (however old), else nothing, and
`merge` then falls back to the small starter list config/sources.json, so a run never fails because of this.
"""
from datetime import datetime, timedelta, timezone
import json
import time
import os
import re
import secrets
import urllib.request

from .paths import DATA
from .sources import ats

URL = 'https://www.jobpilotto.workers.dev/api/index'
CACHE = DATA / 'employer_index.json'
MAX_AGE = timedelta(hours=20)     # "at most daily", with slack for a run that starts a little early
TIMEOUT = 10


def _get(url, headers):
    """(status, body text, etag); 304 has no body. Raises on network errors and other statuses."""
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT, **headers})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, response.read().decode('utf-8'), response.headers.get('ETag')
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return 304, '', None
        raise


def _mint(base, install):
    """The index token for this install id from the website ('' when it cannot be had: the download is then tried without)."""
    request = urllib.request.Request(f'{base}/api/install-token', method='POST',
                                     data=json.dumps({'install': install, 'purpose': 'index'}).encode(),
                                     headers={'User-Agent': ats.USER_AGENT, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return str(json.load(response).get('token') or '')
    except Exception:  # noqa: BLE001 — a missing token only means the website decides
        return ''


def clean(feeds):
    """Only well-formed entries for feeds we can crawl: unknown ATS names or missing slugs are dropped."""
    out = []
    for item in feeds if isinstance(feeds, list) else []:
        if not isinstance(item, dict):
            continue
        system, slug, company = item.get('ats'), item.get('slug'), item.get('company')
        if system in ats.FETCHERS and isinstance(slug, str) and slug and isinstance(company, str) and company:
            places = item.get('places')
            out.append({'company': company, 'ats': system, 'slug': slug, 'quality': item.get('quality'),
                        'checked': item.get('checked'),
                        'places': [p for p in places if isinstance(p, str)] if isinstance(places, list) else None,
                        'fits': item.get('fits') if isinstance(item.get('fits'), dict) else None})
    return out


def _read(cache):
    try:
        data = json.loads(cache.read_text())
        return {'fetched': data.get('fetched'), 'etag': data.get('etag'), 'feeds': clean(data.get('feeds')),
                'install': data.get('install')}
    except (OSError, ValueError, AttributeError):
        return None


problem = ''   # why the last load() could not download the index ('' when it could, or did not need to): the run reports it
RETRY_WAIT = 3   # seconds before the one retry of a failed download (a blip must not cost the whole crawl its 247 feeds)


def load(cache=None, url=None, get=_get, now=None, install_id=None, retry_wait=None, mint=None):
    """The downloaded index (list of feeds), from the cache when it is under a day old. Never raises."""
    global problem
    problem = ''
    retry_wait = RETRY_WAIT if retry_wait is None else retry_wait
    cache = cache or CACHE
    url = url or os.getenv('JOB_PILOTTO_INDEX_URL') or URL
    now = now or datetime.now(timezone.utc)
    stored = _read(cache)
    if stored and stored['fetched']:
        try:
            if now - datetime.fromisoformat(stored['fetched']) < MAX_AGE:
                return stored['feeds']
        except ValueError:
            pass
    headers = {'Accept': 'application/json'}
    # The id is random and local: the one the app shares with the pool when you opted in, else one kept next to the cache.
    install_id = install_id or os.getenv('JOB_PILOTTO_INSTALL_ID') or (stored or {}).get('install')
    if not (install_id and re.fullmatch(r'[A-Za-z0-9_-]{8,64}', install_id)):
        install_id = secrets.token_hex(12)
    headers['X-Install-Id'] = install_id
    mint = mint if mint is not None else (_mint if get is _get else (lambda base, install: ''))
    token = mint(url.rsplit('/api/', 1)[0], install_id)
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if stored and stored['etag']:
        headers['If-None-Match'] = stored['etag']
    try:
        for attempt in (1, 2):
            try:
                status, body, etag = get(url, headers)
                if status == 304 and stored:
                    feeds, etag = stored['feeds'], stored['etag']
                else:
                    feeds = clean(json.loads(body).get('feeds'))
                break
            except Exception:  # noqa: BLE001 — once more after a short wait, then the outer handler decides
                if attempt == 2:
                    raise
                time.sleep(retry_wait)
        entry = {'fetched': now.isoformat(timespec='seconds'), 'etag': etag, 'install': install_id, 'feeds': feeds}
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(entry, indent=1, ensure_ascii=False) + '\n')
        return feeds
    except Exception as error:  # noqa: BLE001 — the index is a bonus: any trouble means "use what we have"
        problem = f'{type(error).__name__}: {error}'
        print(f'Warning: employer index not downloaded ({problem}); '
              f'using {"the cache" if stored else "the starter list only"}')
        return stored['feeds'] if stored else []


def merge(starter, index, skip=lambda company: False):
    """Starter list first (it keeps its names), then downloaded feeds not already in it, minus skipped companies."""
    merged = {}
    for source in [*starter, *index]:
        key = (source.get('ats', 'greenhouse'), source.get('slug') or source['board'])
        if key not in merged and not skip(source['company']):
            merged[key] = dict(source)
    return list(merged.values())


def relevant(index, wanted_location):
    """Only feeds with roles in the user's own places (their search.json), so a worldwide index doesn't cost every
    crawl the time of feeds it would throw away. A feed with no place information (older index) is kept."""
    return [f for f in index
            if not f.get('places') or any(wanted_location({'location': place}) for place in f['places'])]
