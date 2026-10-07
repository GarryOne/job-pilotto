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
MAX_LIST = 40   # the Actions list scrolls (7 Oct 2026: H&M, Manor and Rolex were left out at 15)
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


def unread_picks(db_path=None, limit=30):
    """Employers the scout picked for THIS search (its AI ideas and the user's own lists, never the old tech seed lists) that ended with no
    readable job site, with an address to open: [{name, url}], best first. Owner, 7 Oct 2026: "for a photographer or store manager, start with
    H&M, Manor… the sites we cannot read ourselves that are relevant for such a candidate", not only LinkedIn and Glassdoor."""
    import sqlite3
    from ..paths import JOBS_DB
    try:
        with sqlite3.connect(db_path or JOBS_DB) as db:
            rows = db.execute("""SELECT name, COALESCE(NULLIF(careers, ''), website) FROM scout_candidates
                WHERE status IN ('none', 'watch') AND COALESCE(NULLIF(careers, ''), website, '') LIKE 'http%'
                AND origin NOT LIKE 'Tier 1%' AND origin NOT LIKE 'Seed%' ORDER BY priority DESC, checked_at DESC LIMIT ?""", (limit,)).fetchall()
    except sqlite3.Error:
        return []
    return [{'name': name, 'url': url} for name, url in rows]


def visit_list(search=None, kinds=None, now=None, picks=None):
    """What to offer for a visit: the employers first (refused ones, then the scout's unread picks for this search), then the portals, each
    group least recently read first: [{name, url, kind: 'employer'|'portal', why, last_read, note}]."""
    now = now or _now()
    data = _load()
    # A read that found no jobs is not a read: the site comes back at once (7 Oct 2026: home pages read as 0 jobs hid Hublot, IWC… for a week).
    read = {host: entry for host, entry in (data.get('reads') or {}).items() if entry.get('jobs')}
    stale = (now - timedelta(days=STALE_DAYS)).isoformat(timespec='seconds')
    out = []
    for site in (data.get('sites') or {}).values():
        last = (read.get(host_of(site['url'])) or {}).get('at')
        if not last or last < stale:
            out.append({'name': site['company'], 'url': site['url'], 'kind': 'employer', 'why': 'refuses automated visitors', 'last_read': last, 'note': ''})
    have = {host_of(item['url']) for item in out}
    jobpages = data.get('jobpages') or {}
    for pick in (unread_picks() if picks is None else picks):
        pick = {**pick, 'url': jobpages.get(host_of(pick['url']), pick['url'])}   # its job list once found, not its home page
        last = (read.get(host_of(pick['url'])) or {}).get('at')
        if host_of(pick['url']) not in have and (not last or last < stale):
            have.add(host_of(pick['url']))
            out.append({'name': pick['name'], 'url': pick['url'], 'kind': 'employer', 'why': 'picked for your search, no job list we can read', 'last_read': last,
                        'note': 'Opens their site: if it is not their job list, go to it, then click the Job Pilotto icon'})
    for portal in portals(search, kinds):
        last = (read.get(host_of(portal['url'])) or {}).get('at')
        if not last or last < stale:
            out.append({'name': portal['name'], 'url': portal['url'], 'kind': 'portal', 'why': 'no way in but your own visit', 'last_read': last, 'note': portal['note']})
    return sorted(out, key=lambda item: (item['kind'] != 'employer', item['last_read'] or ''))[:MAX_LIST]


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
    # When most cards link to a single job (an id in the path, or a job id in the query: Indeed's jk=, Glassdoor's jl=, LinkedIn's
    # currentJobId=), the cards without one are the site's menu (7 Oct 2026: Glassdoor's "Zum Inhalt springen", "Jobs", "Für dich" were read as jobs).
    with_id = [job for job in jobs if _has_job_id(job['url'])]
    return with_id if len(with_id) >= 3 else jobs


QUERY_ID = re.compile(r'(?:^|&)(?:jk|jl|jobid|job_id|currentjobid|vjk|gh_jid|id)=[0-9a-z_-]{5,}', re.I)


def _has_job_id(link):
    parts = urllib.parse.urlsplit(link)
    return bool(careers.JOB_ID.search(parts.path.rstrip('/')) or QUERY_ID.search(parts.query))


def fitting(jobs):
    """The jobs a jobs check would keep: your role words and your places (src/sources/feeds.py, the same filter), so a read says
    honestly how many of its jobs reach your list (owner, 7 Oct 2026: "Read 5 jobs from Indeed, but my Jobs count never grows")."""
    from . import feeds
    return [job for job in jobs if feeds.wanted_title(job.get('title') or '') and feeds.wanted_location(job)]


def read(url, markup, cards=None, title='', now=None, session='', start=''):
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
        # A job page that shows no jobs at all, twice, was the wrong page, or moved (7 Oct 2026: "a wrong job page sticks forever"): forgotten, and
        # not chosen again for BAD_DAYS, so the next visit looks for the site's job list afresh.
        # Twice in a row: once may be a reading that failed (a banner, a slow page), not a wrong page.
        found_at = [site for site, page in (data.get('jobpages') or {}).items() if page.split('#')[0].rstrip('/') == url.split('#')[0].rstrip('/')]
        empty = data.setdefault('jobpage_empty', {})
        if found_at and not going_on:
            empty[feed] = 0 if merged else empty.get(feed, 0) + 1
        if found_at and not merged and not going_on and empty.get(feed, 0) >= 2:
            empty.pop(feed, None)
            for site in found_at:
                data['jobpages'].pop(site)
            data.setdefault('jobpage_bad', {})[url.split('#')[0]] = now.isoformat(timespec='seconds')
            print(f"Visit: {url.split('#')[0]} showed no jobs: no longer used as {', '.join(found_at)}'s job page")
        if start and merged and not portal and feed.rstrip('/') != start.split('#')[0].rstrip('/'):   # the job list found elsewhere (iwc.com's on careers.richemont.com,
            data.setdefault('jobpages', {})[host_of(start)] = feed   # by a Read with Claude session, 7 Oct 2026): Open goes straight there next time
        data['reads'][host]['jobs'] = len(merged)
        _save(data)
    fits = len(fitting(merged))
    print(f"Visit: read {len(jobs)} jobs on {name} ({host}) from a page you opened; {added} new in this visit, {len(merged)} in all, {fits} matching your search")
    return {'name': name, 'jobs': merged, 'kind': 'portal' if portal else 'employer', 'feed': feed, 'added': added, 'fits': fits}


def session_result(session):
    """What a Read with Claude session saved: its pages add up under its session name (read_<id>.json), or one name per site when it read
    several (read_<id>_<n>.json): {name, jobs, fits, feeds, sites}, or None when it saved nothing. The app reports it when the session ends
    (owner, 7 Oct 2026: "Read with Claude never reports back")."""
    data = _load()
    base = re.sub(r'\.json$', '', session)
    names = [name for name in (data.get('sessions') or {}) if name == session or re.fullmatch(re.escape(base) + r'(_\d+)?\.json', name)]
    pages = [(data.get('pages') or {}).get(data['sessions'][name]) for name in names]
    pages = [page for page in pages if page]
    if not pages:
        return None
    jobs = [job for page in pages for job in page.get('jobs') or []]
    return {'name': ', '.join(page.get('name') or '' for page in pages)[:160], 'jobs': len(jobs), 'fits': len(fitting(jobs)),
            'feeds': [data['sessions'][name] for name in names], 'sites': len(pages)}


MISS_DAYS = 7   # a site whose job page a search could not find is not searched again for a week
BAD_DAYS = 30   # a job page that showed no jobs is not chosen again for this long


def _bad_pages(data, now):
    since = (now - timedelta(days=BAD_DAYS)).isoformat(timespec='seconds')
    return {page.rstrip('/') for page, at in (data.get('jobpage_bad') or {}).items() if at > since}


def find_job_pages(sites, countries=(), search=None, now=None):
    """Each employer's job list before its tab opens (owner, 7 Oct 2026: "rebuild the URLs to go to the jobs page, not the home page"): one
    "<company> jobs" web search per site with no known job page, preferring an address for your country (/ch-en, ?country=ch). Kept per site,
    a miss too (for MISS_DAYS). Returns {start url: job page url} for the sites that have one."""
    from . import web_search
    now = now or _now()
    search = search or web_search.job_sites
    data = _load()
    known, missed = data.get('jobpages') or {}, data.get('jobpage_misses') or {}
    recent = (now - timedelta(days=MISS_DAYS)).isoformat(timespec='seconds')
    local = [re.compile(rf'(?<![a-z]){re.escape(code.lower())}(?![a-z])') for code in countries or () if len(code) == 2]
    found = {}
    for site in sites:
        host = host_of(site['url'])
        if site['url'] in known.values():   # already its job page (visit_list swaps it in)
            continue
        if host in known or site.get('kind') == 'portal' or missed.get(host, '') > recent or not web_search.provider():
            if host in known:
                found[site['url']] = known[host]
            continue
        bad = _bad_pages(data, now)
        urls = [url for url in search(site['name']) if url.split('#')[0].rstrip('/') not in {site['url'].rstrip('/'), *bad}]
        ours = [url for url in urls if any(code.search(urllib.parse.urlsplit(url.lower()).path + '?' + urllib.parse.urlsplit(url.lower()).query) for code in local)]
        page = (ours or urls or [None])[0]
        print(f"Visit: job page of {site['name']}: {page or 'not found'}")
        with LOCK:
            fresh = _load()
            if page:
                fresh.setdefault('jobpages', {})[host] = page
                found[site['url']] = page
            else:
                fresh.setdefault('jobpage_misses', {})[host] = now.isoformat(timespec='seconds')
            _save(fresh)
    return found


def job_page(url, markup):
    """The job list's address from a page that is not one (a home page: hublot.com/en-ch, whose jobs are at /joboffers/en): the page's own
    careers link (careers.careers_links, no AI), else the scout's AI link chooser. Kept per site, so the next Open goes straight there.
    Owner, 7 Oct 2026: "on this homepage there are no jobs; this should be the right page"."""
    found = careers.careers_links(markup or '', url)
    if not found:
        choose = careers.chooser()
        try:
            found = choose(url, markup or '') if choose else []
        except Exception as error:  # noqa: BLE001 — no answer: the page is read as it is
            print(f'Warning: job list link not chosen for {host_of(url)} ({type(error).__name__})')
            found = []
    if not found:   # no careers link and no AI pick: "<company> jobs", as a person would (owner, 7 Oct 2026: the most reliable)
        from . import web_search
        if web_search.provider():
            name = re.sub(r'<[^>]+>', '', (re.search(r'<title[^>]*>(.*?)</title>', markup or '', re.S | re.I) or [None, ''])[1]).split('|')[0].split(' - ')[0].strip()
            name = name if 2 <= len(name) <= 60 else host_of(url).split('.')[0]
            try:
                found = web_search.job_sites(name)
            except Exception as error:  # noqa: BLE001
                print(f'Warning: web search for {name} jobs failed ({type(error).__name__})')
                found = []
    bad = _bad_pages(_load(), _now())
    page = next((link for link in found if link.split('#')[0] != url.split('#')[0] and link.split('#')[0].rstrip('/') not in bad), None)
    if page:
        with LOCK:
            data = _load()
            data.setdefault('jobpages', {})[host_of(url)] = page
            _save(data)
        print(f'Visit: the job list of {host_of(url)} is {page}')
    return page


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
