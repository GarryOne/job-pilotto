"""Reading the jobs of a page a person opened and sent: its own job data, the cards the extension saw, or the careers reader; kept per
page and paging session, with the count of jobs that fit the search.

Split out of visits.py (pure move; visits.py re-exports it). The store (STORE, LOCK, _load, _save, _now) stays in visits.py
and is looked up there at call time, so tests that patch `visits.STORE` / `visits._now` keep working. Guarded by tests/test_visits.py,
test_visit_reader.py and test_visit_filters.py.
"""
import hashlib
import re
import urllib.parse

from . import ats, careers
from .visits_portals import PORTALS


def _title_place(title):
    """The place named in a job title ("Conseiller de vente - Genève (F/H)" -> "Genève"), or ''."""
    found = careers._places().search(title or '')
    return found.group(0)[:60] if found else ''


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
        # The place from the card's lines, else from its title (7 Oct 2026: Dior's "Conseiller de vente - Genève (F/H)" had no place line
        # and was left out of the search as placeless).
        job = ats._job(hashlib.sha1(link.encode()).hexdigest()[:16], title, _place(rest) or _title_place(title), link)
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
    feeds.triage(jobs)
    return [job for job in jobs if feeds.wanted_title(job.get('title') or '') and feeds.wanted_location(job)]


def read(url, markup, cards=None, title='', now=None, session='', start='', known_list=False, place=''):
    """Read the jobs on a page a person opened and sent: the page's own job data, else the cards the extension saw, else the careers reader
    (its links, a recipe learned earlier, AI as the last resort). Nothing is fetched: a site that refused us would refuse that too.
    Pages of one paging session (the extension going through a list) add up under the session's first page. Returns {name, jobs, kind,
    feed, added}; the jobs are kept as the feed visit:<feed>."""
    now = now or visits._now()
    host = visits.host_of(url)
    portal = next((key for key, p in PORTALS.items() if p['host'] in host), None)
    jobs = careers.jsonld_jobs(markup or '', url) or _from_cards(cards, url)
    if not jobs and markup:
        links = [(link, text) for link, text in careers.links(markup, url) if link in set(careers.job_links(markup, url))]
        jobs = [ats._job(hashlib.sha1(link.encode()).hexdigest()[:16], text[:160], '', link) for link, text in links if 4 <= len(text) <= 160]

        def nothing(_):
            raise ValueError('a visited page is read as it was sent: nothing is fetched')
        jobs = careers._asked(url, markup, jobs, nothing)
    jobs = list({job['url']: job for job in jobs}.values())[:visits.MAX_JOBS]
    # The page was filtered to your place (the extension's place step took): a job with no place on its card is in it (8 Oct 2026: Fust's list
    # filtered to Genf, Manor's, Tiffany's cards had no place line, so none could ever match your places).
    place = re.sub(r'\s+', ' ', str(place or '')).strip()[:80]
    for job in jobs if place else []:
        if not (job.get('location') or '').strip():
            job['location'] = place
    with visits.LOCK:
        data = visits._load()
        site = (data.get('sites') or {}).get(host)
        name = PORTALS[portal]['name'] if portal else (site or {}).get('company') or (title or host).split('|')[0].split(' - ')[0].strip()[:120] or host
        data.setdefault('reads', {})[host] = {'at': now.isoformat(timespec='seconds'), 'url': url, 'jobs': len(jobs)}
        if jobs and ((data.get('recipes') or {}).get(host) or {}).get('missed'):   # the recipe read jobs again: its misses start over
            data['recipes'][host]['missed'] = 0
        sessions = data.setdefault('sessions', {})
        going_on = bool(session) and session in sessions   # a later page of the same list: its jobs add to the first page's
        feed = sessions[session] if going_on else url.split('#')[0]
        if session:
            sessions[session] = feed
            for old in list(sessions)[:-50]:
                sessions.pop(old)
        pages = data.setdefault('pages', {})
        before = (pages.get(feed) or {}).get('jobs') or [] if going_on else []
        merged = list({job['url']: job for job in [*before, *jobs]}.values())[:visits.MAX_JOBS]
        added = len(merged) - len(before)
        pages[feed] = {'name': name, 'portal': bool(portal), 'at': now.isoformat(timespec='seconds'), 'jobs': merged}
        # A job page that shows no jobs at all, twice, was the wrong page, or moved (7 Oct 2026: "a wrong job page sticks forever"): forgotten, and
        # not chosen again for BAD_DAYS, so the next visit looks for the site's job list afresh.
        # Twice in a row: once may be a reading that failed (a banner, a slow page), not a wrong page.
        found_at = [site for site, page in (data.get('jobpages') or {}).items() if page.split('#')[0].rstrip('/') == url.split('#')[0].rstrip('/')]
        empty = data.setdefault('jobpage_empty', {})
        # known_list: the site's own list by its learned layout, with no jobs in your places today: not a wrong page, its count is left as is.
        if found_at and not going_on and not (known_list and not merged):
            empty[feed] = 0 if merged else empty.get(feed, 0) + 1
        missing = bool(re.search(r'\b404\b|not found|introuvable|nicht gefunden|non trovata', title or '', re.I))   # a page that is not there: at once
        if found_at and not merged and not going_on and (empty.get(feed, 0) >= 2 or missing):
            empty.pop(feed, None)
            for site in found_at:
                data['jobpages'].pop(site)
            data.setdefault('jobpage_bad', {})[url.split('#')[0]] = now.isoformat(timespec='seconds')
            print(f"Visit: {url.split('#')[0]} showed no jobs: no longer used as {', '.join(found_at)}'s job page")
        if start and merged and not portal and feed.rstrip('/') != start.split('#')[0].rstrip('/'):   # the job list found elsewhere (iwc.com's on careers.richemont.com,
            data.setdefault('jobpages', {})[visits.host_of(start)] = feed   # by a Read with Claude session, 7 Oct 2026): Open goes straight there next time
        data['reads'][host]['jobs'] = len(merged)
        visits._save(data)
    fits = len(fitting(merged))
    # This page's jobs in your places (Claude places them first): the extension stops a list after two pages with none, when their places
    # say they are elsewhere (7 Oct 2026: Chanel's worldwide list, 9 pages, 180 jobs, 0 in Geneva). A card without a place counts as neither.
    from . import feeds
    placed = [job for job in jobs if (job.get('location') or '').strip()]
    try:
        feeds.triage_places(placed)
    except Exception:  # noqa: BLE001 — the place words decide this page
        pass
    here = sum(1 for job in placed if feeds.wanted_location(job))
    print(f"Visit: read {len(jobs)} jobs on {name} ({host}) from a page you opened; {added} new in this visit, {len(merged)} in all, {fits} matching your search"
          + (f"; {here} of {len(placed)} on this page in your places" if placed else "; no place on this page's cards: where these jobs are is not known"))
    return {'name': name, 'jobs': merged, 'kind': 'portal' if portal else 'employer', 'feed': feed, 'added': added, 'fits': fits,
            'in_places': here, 'placed': len(placed)}


def session_result(session):
    """What a Read with Claude session saved: its pages add up under its session name (read_<id>.json), or one name per site when it read
    several (read_<id>_<n>.json): {name, jobs, fits, feeds, sites}, or None when it saved nothing. The app reports it when the session ends
    (owner, 7 Oct 2026: "Read with Claude never reports back")."""
    data = visits._load()
    base = re.sub(r'\.json$', '', session)
    names = [name for name in (data.get('sessions') or {}) if name == session or re.fullmatch(re.escape(base) + r'(_\d+)?\.json', name)]
    pages = [(data.get('pages') or {}).get(data['sessions'][name]) for name in names]
    pages = [page for page in pages if page]
    if not pages:
        return None
    jobs = [job for page in pages for job in page.get('jobs') or []]
    return {'name': ', '.join(page.get('name') or '' for page in pages)[:160], 'jobs': len(jobs), 'fits': len(fitting(jobs)),
            'feeds': [data['sessions'][name] for name in names], 'sites': len(pages)}


from . import visits  # noqa: E402  (at the end: visits imports this file back, so importing this file first works too)
