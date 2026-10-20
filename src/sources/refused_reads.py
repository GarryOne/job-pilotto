"""Refused sites read in the user's own browser (owner, 19 Oct 2026; rule: CLAUDE.md "Never past a login wall", the opt-in exception). Unless the user turned
off "Read refused sites in my browser", which is on by default (the app checks the setting before it asks this file anything): the employer career sites and job boards that refused the engine
(401/403/429, a bot check) are fetched ONCE by the extension from the user's Chrome, without cookies or logins, at most every READ_DAYS, one at a time, and the page it brings
is read like a page the person opened (visits_read.read). A bot check, a refusal or a login page in the browser means stop and record: never retried, never solved.
Never LinkedIn, Indeed, Glassdoor, levels.fyi, Reddit or any login wall. Guarded by tests/test_refused_reads.py and desktop/test/refused-reads.test.js."""
import re
import urllib.parse
from datetime import datetime, timedelta, timezone

from ..ai import board_ideas
from ..paths import load_search_config
from . import render, visits

READ_DAYS = 30      # a site is asked once in this many days, whatever it answered
MAX_QUEUE = 12      # sites handed to the extension in one go
CONCURRENCY = 1     # the extension asks one site at a time, with a pause (extension/refused-read.js)
NEVER = (*board_ideas.PORTALS, 'reddit.', 'xing.')   # login-wall sites: only through the person's own visit
LOGIN_PATH = re.compile(r'/(?:log-?in|sign-?in|sso|oauth\d*|authorize|uas/login|account/login|auth)(?:[/?#.]|$)', re.I)   # a floor: the page we landed on is a login page


def search_config():
    return load_search_config(matching=False)


def _now():
    return datetime.now(timezone.utc)


def allowed(url):
    """False for LinkedIn, Indeed, Glassdoor, levels.fyi, Reddit and a page that is not a plain https address."""
    parts = urllib.parse.urlsplit(url or '')
    host = (parts.hostname or '').lower()
    return parts.scheme == 'https' and bool(host) and not any(word in f'{host}.' for word in NEVER)


def _recent(kept, host, now):
    stamp = (kept.get(host) or {}).get('at')
    return bool(stamp) and stamp >= (now - timedelta(days=READ_DAYS)).isoformat(timespec='seconds')


def _board_url(board, search):
    from . import found_boards
    place = (found_boards._places(search) or [''])[0] if '{place}' in board['search_url'] else ''
    terms = found_boards._terms(search, 1)
    if not terms:
        return None
    return board['search_url'].replace('{role}', urllib.parse.quote_plus(terms[0])).replace('{place}', urllib.parse.quote_plus(place))


def queue(now=None, limit=MAX_QUEUE):
    """[{url, name, kind: 'employer'|'board'}]: refused employer sites, then boards marked 'browser', that were not asked in the last READ_DAYS."""
    now = now or _now()
    data = visits._load()
    kept = data.get('refused_reads') or {}
    out, seen = [], set()
    for site in (data.get('sites') or {}).values():
        host = visits.host_of(site['url'])
        if allowed(site['url']) and host not in seen and not _recent(kept, host, now):
            seen.add(host)
            out.append({'url': site['url'], 'name': site['company'], 'kind': 'employer'})
    search = None
    for board in (board_ideas.load().get('boards') or {}).values():
        if board.get('state') != 'browser':
            continue
        search = search or search_config()
        url = _board_url(board, search)
        host = visits.host_of(url or '')
        if url and allowed(url) and host not in seen and not _recent(kept, host, now):
            seen.add(host)
            out.append({'url': url, 'name': board.get('name') or host, 'kind': 'board'})
    return out[:limit]


def _keep(host, url, state, why, now):
    with visits.LOCK:
        data = visits._load()
        data.setdefault('refused_reads', {})[host] = {'at': now.isoformat(timespec='seconds'), 'url': url, 'state': state, 'why': why}
        visits._save(data)


def _stop_why(status, html, final):
    """Why this page ends the visit, or ''. A refusal status, a bot check (the page is short and says so) or a login page: a floor, never a judgment of a good page."""
    if status in (401, 403, 429):
        return f'HTTP {status}'
    text = (html or '')[:6000].lower()
    if len(html or '') < 20000 and any(word in text for word in render.CHALLENGE):
        return 'a bot check'
    if final and (not allowed(final) or LOGIN_PATH.search(urllib.parse.urlsplit(final).path)):
        return 'a login page'
    return ''


def outcome(url, status, html, title='', final='', now=None):
    """What the extension's fetch of `url` brought: {ok, state: 'read'|'empty'|'stopped'|'skipped', jobs, why, name, feed}. Every answer is kept so the site is not asked again for READ_DAYS."""
    now = now or _now()
    host = visits.host_of(url)
    if not allowed(url):
        return {'ok': True, 'state': 'skipped', 'why': 'a site that is only read through your own visit', 'name': host}
    why = _stop_why(int(status or 0), html, final)
    if why:
        _keep(host, url, 'stopped', why, now)
        print(f'Refused sites: {host} stopped ({why}); not asked again for {READ_DAYS} days')
        return {'ok': True, 'state': 'stopped', 'why': why, 'name': host}
    result = visits.read(url, html or '', None, title or '', now=now)
    state = 'read' if result['jobs'] else 'empty'
    _keep(host, url, state, '', now)
    print(f"Refused sites: read {host} in your browser: {len(result['jobs'])} job(s), {result.get('fits', 0)} matching your search")
    return {'ok': True, 'state': state, 'jobs': len(result['jobs']), 'fits': result.get('fits', 0), 'name': result['name'], 'feed': result['feed']}
