"""Sites only you can open (owner, 7 Oct 2026): employers whose job site refuses automated visitors (401/403/429, a bot check) and job portals
with no open API (LinkedIn, Indeed, Glassdoor, levels.fyi). The app lists them; you open one in your own Chrome, as yourself, and the
extension's "Read the jobs on this page" sends the page you see to the app. Nothing here browses, clicks, logs in or gets past a check:
the page arrives only because a person opened it and pressed the button.

The jobs read are kept in data/visits.json and served as the feed `visit:<page address>` (ats.FETCHERS['visit']), so the next jobs check
filters, scores and tracks them like any other feed. A page read more than STALE_DAYS ago is offered again."""
import hashlib
import json
import re
import threading
import urllib.parse
from datetime import datetime, timedelta, timezone

from ..paths import DATA, load_search_config
from . import ats, careers

STORE = DATA / 'visits.json'
STALE_DAYS = 7          # a page read longer ago is offered for a visit again (its jobs come and go)
KEEP_DAYS = 21          # a visit's jobs are served for this long; then the feed is empty until the next visit
MAX_JOBS = 500
MAX_LIST = 12
LOCK = threading.Lock()
# Portals with no API for this: a visit is the way in. The search page is built from the user's own first role word and place.
PORTALS = {
    'linkedin': {'name': 'LinkedIn', 'host': 'linkedin.com', 'url': 'https://www.linkedin.com/jobs/search/?keywords={role}&location={place}',
                 'note': 'LinkedIn forbids reading its pages with an extension and may restrict accounts that do: one read per click keeps that small, not zero'},
    'indeed': {'name': 'Indeed', 'host': 'indeed.', 'url': 'https://{indeed}/jobs?q={role}&l={place}', 'note': ''},
    'glassdoor': {'name': 'Glassdoor', 'host': 'glassdoor.', 'url': 'https://www.glassdoor.com/Job/jobs.htm?sc.keyword={role}&locKeyword={place}', 'note': ''},
    'levelsfyi': {'name': 'levels.fyi', 'host': 'levels.fyi', 'url': 'https://www.levels.fyi/jobs?searchText={role}&location={place}', 'note': '', 'kinds': {'software'}},
}
# Indeed's site per country (7 Oct 2026: a Swiss search opened www.indeed.com and read jobs in Michigan); the search's own countries pick it.
INDEED = {'ch': 'ch.indeed.com', 'de': 'de.indeed.com', 'at': 'at.indeed.com', 'fr': 'fr.indeed.com', 'it': 'it.indeed.com', 'gb': 'uk.indeed.com',
          'ie': 'ie.indeed.com', 'nl': 'nl.indeed.com', 'be': 'be.indeed.com', 'lu': 'lu.indeed.com', 'es': 'es.indeed.com', 'pt': 'pt.indeed.com',
          'se': 'se.indeed.com', 'dk': 'dk.indeed.com', 'no': 'no.indeed.com', 'fi': 'fi.indeed.com', 'pl': 'pl.indeed.com', 'cz': 'cz.indeed.com',
          'ro': 'ro.indeed.com', 'gr': 'gr.indeed.com', 'us': 'www.indeed.com', 'ca': 'ca.indeed.com', 'au': 'au.indeed.com', 'sg': 'sg.indeed.com',
          'in': 'in.indeed.com', 'ae': 'ae.indeed.com', 'br': 'br.indeed.com', 'mx': 'mx.indeed.com', 'jp': 'jp.indeed.com'}
REFUSED = re.compile(r'\b(401|403|429)\b|Refused|bot check', re.I)


def _now():
    return datetime.now(timezone.utc)


def _load():
    try:
        data = json.loads(STORE.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data):
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(data, indent=1, ensure_ascii=False) + '\n')


def host_of(url):
    return (urllib.parse.urlsplit(url if '//' in url else f'https://{url}').hostname or '').lower().removeprefix('www.')


def refused(company, url, why, now=None):
    """Note an employer whose job site refused us (from the scout or a jobs check): it is offered for a visit. Only 401/403/429 or a bot check."""
    if not url or not REFUSED.search(str(why)):
        return False
    with LOCK:
        data = _load()
        sites = data.setdefault('sites', {})
        line = sites.setdefault(host_of(url), {'company': company, 'url': url})
        line.update({'why': str(why)[:80], 'refused_at': (now or _now()).isoformat(timespec='seconds')})
        _save(data)
    print(f'Visit: {company} ({host_of(url)}) refused us ({str(why)[:60]}): offered as a site only you can open')
    return True


def _plain_words(fragments):
    """A search pattern as the words a portal's search box takes: a letter choice as its accented letter ("gen[èe]ve" -> "genève",
    7 Oct 2026: it became "gen ve", so LinkedIn ignored the place and showed the signed-in account's own suggestions), a choice of forms as
    the first one ("vendeu(r|se)" -> "vendeur"), an optional ending left out ("photograph(e|er)?" -> "photograph")."""
    def letter(match):
        choice = match.group(1)
        return next((c for c in choice if ord(c) > 127), choice[-1:])
    words = []
    for fragment in fragments:
        text = re.sub(r'\\b', '', str(fragment))
        text = re.sub(r'\([^()]*\)\?', '', text)
        text = re.sub(r'\(([^()|]*)\|[^()]*\)', r'\1', text)
        text = re.sub(r'\[([^\]]*)\]', letter, text)
        text = re.sub(r'\\(.)', r'\1', text)
        text = re.sub(r'[()?*+|^$]|\.\*', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            words.append(text)
    return words


def portals(search=None, kinds=None):
    """The portal search pages for this user's first role word and place: [{key, name, url, note}]."""
    search = search or load_search_config(matching=False)
    roles = _plain_words(search.get('role_keywords') or [])
    places = _plain_words((search.get('locations') or {}).get('top_tier') or [])
    if not roles:
        return []
    from .. import pool_tags
    countries, _ = pool_tags.places([*places, *_plain_words((search.get('locations') or {}).get('country_wide') or [])])
    indeed = next((INDEED[country] for country in countries if country in INDEED), 'www.indeed.com')
    out = []
    for key, portal in PORTALS.items():
        if portal.get('kinds') and kinds is not None and not (portal['kinds'] & set(kinds)):
            continue
        url = portal['url'].format(role=urllib.parse.quote(roles[0]), place=urllib.parse.quote(places[0] if places else ''), indeed=indeed)
        out.append({'key': key, 'name': portal['name'], 'url': url, 'note': portal['note']})
    return out


def visit_list(search=None, kinds=None, now=None):
    """What to offer for a visit, least recently read first: [{name, url, kind: 'employer'|'portal', why, last_read, note}]."""
    now = now or _now()
    data = _load()
    read = data.get('reads') or {}
    stale = (now - timedelta(days=STALE_DAYS)).isoformat(timespec='seconds')
    out = []
    for site in (data.get('sites') or {}).values():
        last = (read.get(host_of(site['url'])) or {}).get('at')
        if not last or last < stale:
            out.append({'name': site['company'], 'url': site['url'], 'kind': 'employer', 'why': 'refuses automated visitors', 'last_read': last, 'note': ''})
    for portal in portals(search, kinds):
        last = (read.get(host_of(portal['url'])) or {}).get('at')
        if not last or last < stale:
            out.append({'name': portal['name'], 'url': portal['url'], 'kind': 'portal', 'why': 'no way in but your own visit', 'last_read': last, 'note': portal['note']})
    return sorted(out, key=lambda item: (item['last_read'] or '', item['kind'] != 'employer'))[:MAX_LIST]


def listed(url):
    """True when this page's site is on the visit list (the extension lights its icon there)."""
    host = host_of(url)
    data = _load()
    return host in (data.get('sites') or {}) or any(portal['host'] in host for portal in PORTALS.values())


def _place(lines):
    pattern = careers._places()
    for line in lines:
        if pattern.search(line) or re.search(r'\bremote\b|hybrid|t[ée]l[ée]travail', line, re.I):
            return line[:120]
    return ''


def _from_cards(cards, url):
    """Jobs from the cards the extension saw (each: title, address, the card's visible lines): portals list many employers per page."""
    jobs = []
    for card in cards or []:
        title = re.sub(r'\s+', ' ', str(card.get('title') or '')).strip()[:160]
        link = urllib.parse.urljoin(url, str(card.get('url') or ''))
        if not title or not link.startswith('http'):
            continue
        lines = [re.sub(r'\s+', ' ', str(line)).strip()[:160] for line in card.get('lines') or [] if str(line).strip()]
        rest = [line for line in lines if line != title]
        job = ats._job(hashlib.sha1(link.encode()).hexdigest()[:16], title, _place(rest), link)
        company = next((line for line in rest if line != job['location'] and not re.search(r'\d+\s*(day|hour|week|month|jour|tag|stunde)|ago|il y a|vor\s', line, re.I)), '')
        if company:
            job['employer'] = company[:120]
        jobs.append(job)
    return jobs


def read(url, markup, cards=None, title='', now=None, session=''):
    """Read the jobs on a page a person opened and sent: the page's own job data, else the cards the extension saw, else the careers reader
    (its links, a recipe learned earlier, AI as the last resort). Nothing is fetched: a site that refused us would refuse that too.
    Pages of one paging session (the extension going through a list) add up under the session's first page. Returns {name, jobs, kind,
    feed, added}; the jobs are kept as the feed visit:<feed>."""
    now = now or _now()
    host = host_of(url)
    portal = next((key for key, p in PORTALS.items() if p['host'] in host), None)
    jobs = careers.jsonld_jobs(markup or '', url) or _from_cards(cards, url)
    if not jobs and markup:
        links = [(link, text) for link, text in careers.links(markup, url) if link in set(careers.job_links(markup, url))]
        jobs = [ats._job(hashlib.sha1(link.encode()).hexdigest()[:16], text[:160], '', link) for link, text in links if 4 <= len(text) <= 160]

        def nothing(_):
            raise ValueError('a visited page is read as it was sent: nothing is fetched')
        jobs = careers._asked(url, markup, jobs, nothing)
    jobs = list({job['url']: job for job in jobs}.values())[:MAX_JOBS]
    with LOCK:
        data = _load()
        site = (data.get('sites') or {}).get(host)
        name = PORTALS[portal]['name'] if portal else (site or {}).get('company') or (title or host).split('|')[0].split(' - ')[0].strip()[:120] or host
        data.setdefault('reads', {})[host] = {'at': now.isoformat(timespec='seconds'), 'url': url, 'jobs': len(jobs)}
        sessions = data.setdefault('sessions', {})
        going_on = bool(session) and session in sessions   # a later page of the same list: its jobs add to the first page's
        feed = sessions[session] if going_on else url.split('#')[0]
        if session:
            sessions[session] = feed
            for old in list(sessions)[:-50]:
                sessions.pop(old)
        pages = data.setdefault('pages', {})
        before = (pages.get(feed) or {}).get('jobs') or [] if going_on else []
        merged = list({job['url']: job for job in [*before, *jobs]}.values())[:MAX_JOBS]
        added = len(merged) - len(before)
        pages[feed] = {'name': name, 'portal': bool(portal), 'at': now.isoformat(timespec='seconds'), 'jobs': merged}
        data['reads'][host]['jobs'] = len(merged)
        _save(data)
    print(f"Visit: read {len(jobs)} jobs on {name} ({host}) from a page you opened; {added} new in this visit, {len(merged)} in all")
    return {'name': name, 'jobs': merged, 'kind': 'portal' if portal else 'employer', 'feed': feed, 'added': added}


def recipe_for(url):
    """The reading recipe learned for this site (src/ai/visit_reader.py), or None."""
    return ((_load().get('recipes') or {}).get(host_of(url)) or {}).get('recipe')


def save_recipe(url, recipe, now=None):
    """Keep a recipe Claude made for this site; the extension replays it with no AI until it stops finding jobs."""
    with LOCK:
        data = _load()
        data.setdefault('recipes', {})[host_of(url)] = {'recipe': recipe, 'learned_at': (now or _now()).isoformat(timespec='seconds')}
        _save(data)
    print(f"Visit: learned how to read {host_of(url)}: blocks {recipe['selector'][:60]}, next page by {recipe['next']}")


def forget_recipe(url):
    """A recipe that found nothing: dropped, so Claude is asked again."""
    with LOCK:
        data = _load()
        if (data.get('recipes') or {}).pop(host_of(url), None) is not None:
            _save(data)
            print(f'Visit: the recipe for {host_of(url)} found no jobs; it is learned again')


def fetch(slug, now=None):
    """The feed visit:<page address>: the jobs read on that page at the last visit, while under KEEP_DAYS old ([] after)."""
    page = (_load().get('pages') or {}).get(slug)
    if not page:
        return []
    if page.get('at', '') < ((now or _now()) - timedelta(days=KEEP_DAYS)).isoformat(timespec='seconds'):
        return []
    return page.get('jobs') or []
