"""A board's search results read past page 1 (owner, 18 Oct 2026: "up to 5 pages"): StepStone listed 148 truck-driver jobs in Nuremberg on
11 pages and the read took 3 from page 1. The next page is found by structure, never per site: the page's own rel=next link, else its
numbered pages (careers_parse.page_links, the careers-page paging of 6 Oct 2026). Paging goes on only while the last page gave a new
relevant job (a title the search wants in a place it wants: board_yield.is_relevant), at most MAX_PAGES pages in all, only where the
site's robots.txt allows the page, with a pause between pages; a refusal (401/403/429, a bot check) or a failed page ends the paging and
keeps what was read. Called by found_boards.read_board for the full read only (the first-jobs slice stays at page 1).
Tests: tests/test_board_pages.py."""
import html
import re
import time
import urllib.parse
import urllib.robotparser

from .careers_parse import page_links

MAX_PAGES = 5       # pages of one board search read at most, page 1 included (owner, 18 Oct 2026)
PAUSE_S = 0.5       # between two pages of one site
AGENT = 'JobPilotto'
_robots = {}        # {origin: RobotFileParser or None (no readable robots.txt: allowed)}: one read per site per run


def next_link(url, markup, numbered):
    """The page after `url`: its rel=next link on the same site, else the first of the numbered pages not read yet; None at the end."""
    host = urllib.parse.urlsplit(url).netloc
    for tag in re.findall(r'<(?:link|a)\b[^>]*\brel=["\']?next\b[^>]*>', markup or '', re.I):
        href = re.search(r'\bhref=["\']([^"\']+)["\']', tag)
        link = _encoded(urllib.parse.urljoin(url, html.unescape(href.group(1)))) if href else ''
        if link and urllib.parse.urlsplit(link).netloc == host:
            return link
    return _encoded(numbered.pop(0)) if numbered else None


def _encoded(link):
    """The address as a request can carry it: a page's link may hold raw spaces ("?q=senior financial analyst&page=2", 18 Oct 2026)."""
    return urllib.parse.quote(link, safe=":/?&=%#+@,;~!$'()*[]")


def allowed(url, fetch):
    """False when the site's robots.txt disallows this page for us; a site whose robots.txt cannot be read allows it."""
    parts = urllib.parse.urlsplit(url)
    origin = f'{parts.scheme}://{parts.netloc}'
    if origin not in _robots:
        try:
            reader = urllib.robotparser.RobotFileParser()
            reader.parse(str(fetch(f'{origin}/robots.txt')).splitlines())
            _robots[origin] = reader
        except Exception:  # noqa: BLE001 — no robots.txt (404) or none readable: nothing is disallowed
            _robots[origin] = None
    return _robots[origin] is None or _robots[origin].can_fetch(AGENT, url)


def more(url, markup, found, fetch, read, relevant, sleep=time.sleep):
    """The jobs on the pages after `url` (page 1, already read into `found`): [] when page 1 gave no relevant job."""
    seen = {job['url'] for job in found}
    if not relevant(found):
        return []
    numbered, read_urls, jobs = page_links(url, markup), {url}, []
    for _ in range(MAX_PAGES - 1):
        link = next_link(url, markup, numbered)
        while link in read_urls:
            link = _encoded(numbered.pop(0)) if numbered else None
        if not link or not allowed(link, fetch):
            break
        sleep(PAUSE_S)
        try:
            markup = fetch(link)
        except Exception:  # noqa: BLE001 — a refusal or a failed page (any error, an odd address too): the paging ends, page 1's jobs stay
            break
        url = link
        read_urls.add(url)
        fresh = [job for job in read(markup, url) if job['url'] not in seen]
        seen |= {job['url'] for job in fresh}
        jobs += fresh
        if not relevant(fresh):
            break
    return jobs
