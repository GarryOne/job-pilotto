"""A company's own careers page, for employers with no job-system feed (Greenhouse, Lever, ...).

The scout uses it on a company website: find the careers link, see whether an ATS is embedded (then its feed is used), else read the jobs
the page itself publishes as schema.org JobPosting data (JSON-LD), on the listing page or on the job pages it links to. Public pages only,
fetched like a browser would, no login, no workaround for a site that refuses (a 403 is an answer). The result is a normal feed:
ats 'careers', slug = the page address written with word characters only (`encode`), so it travels through the employer index unchanged.
"""
import html
import ipaddress
import json
import os
import re
import socket
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from . import ats

MAX_BYTES = 2_000_000
MAX_JOB_PAGES = 40       # job pages read when the listing carries no data itself
CAREER_WORDS = re.compile(r'career|karriere|carri[eè]re|jobs?\b|stellen|offene.?stellen|vacanc|join.?us|work.?with.?us|emploi|recrut|lavora', re.I)
JOB_PATH = re.compile(r'/(?:job|jobs|stelle|stellen|vacanc\w*|position|positions|offre|offres|emploi|posting|opening|openings|career|careers|karriere|job-advertisement|advertisement)/[^/?#]+', re.I)
COUNTRIES = {'CH': 'Switzerland', 'DE': 'Germany', 'AT': 'Austria', 'FR': 'France', 'IT': 'Italy', 'GB': 'United Kingdom', 'UK': 'United Kingdom',
             'NL': 'Netherlands', 'IE': 'Ireland', 'ES': 'Spain', 'PT': 'Portugal', 'PL': 'Poland', 'SE': 'Sweden', 'US': 'United States'}


# Job boards, social networks and directories: a "website" that is one of these is not the employer's own, so it is never read or guessed from.
AGGREGATORS = ('xing.com', 'linkedin.com', 'indeed.com', 'glassdoor.com', 'kununu.com', 'jobs.ch', 'jobup.ch', 'swissdevjobs.ch', 'jobscout24.ch',
               'techtree.dev', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'wikipedia.org', 'google.com', 'monster.com',
               'stepstone.de', 'stepstone.ch', 'jobcloud.ch', 'workable.com', 'greenhouse.io', 'lever.co', 'ashbyhq.com', 'join.com')


def own_site(website):
    """True when the address looks like an employer's own site rather than a job board, network or directory."""
    host = (urllib.parse.urlsplit(website if '//' in (website or '') else f'//{website or ""}').hostname or '').lower().removeprefix('www.')
    return bool(host) and not any(host == d or host.endswith('.' + d) for d in AGGREGATORS)


# ---------- the address as a feed slug ----------

def encode(url):
    """https://www.acme.ch/en/careers -> www.acme.ch__en__careers (word characters, dots and dashes only; the query is dropped)."""
    parts = urllib.parse.urlsplit(url)
    path = '__'.join(segment for segment in parts.path.split('/') if segment)
    slug = f'{parts.hostname or ""}__{path}' if path else (parts.hostname or '')
    if not re.fullmatch(r'[\w.-]{1,120}', slug):
        raise ValueError('address too long or unusual for a feed slug')
    return slug


def decode(slug):
    host, _, path = slug.partition('__')
    if not re.fullmatch(r'[\w.-]+', host):
        raise ValueError('not a careers slug')
    return f'https://{host}/' + '/'.join(segment for segment in path.split('__') if segment)


# ---------- fetching ----------

def _public(host):
    """False for an address that leads to this computer or a private network: a catalog entry must never make a run reach those."""
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR'):
        return True
    try:
        for family, _, _, _, address in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(address[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
    except (OSError, ValueError):
        return False
    return True


def get_text(url):
    """The page's HTML, or raises. Only http(s) to public hosts."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or not _public(parts.hostname):
        raise ValueError('not a public web address')
    fixtures = os.getenv('JOB_PILOTTO_FIXTURE_DIR')
    if fixtures:
        return ats._fixture(fixtures, url).decode('utf-8', 'replace')
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT, 'Accept': 'text/html,application/xhtml+xml'})
    with urllib.request.urlopen(request, timeout=ats.TIMEOUT) as response:
        return response.read(MAX_BYTES).decode(response.headers.get_content_charset() or 'utf-8', 'replace')


# ---------- reading a page ----------

def links(markup, base):
    """(absolute address, link text) for every link on the page."""
    found = []
    for href, inner in re.findall(r'<a\b[^>]*?href=["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)</a>', markup, re.S | re.I):
        found.append((urllib.parse.urljoin(base, html.unescape(href)), re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', inner))).strip()))
    return found


def embedded_system(markup):
    """(ats, slug) of the first job system the page links or embeds, or None."""
    for url in re.findall(r'https?:(?:\\?/){2}[^\s"\'<>\\)]+', markup):
        found = ats.detect(url)
        if found:
            return found
    return None


STRONG_WORDS = re.compile(r'offene.?stellen|stellenangebot|stellenmarkt|stellenportal|open.?positions?|openings|vacanc|job.?overview|jobportal|all.?jobs|alle.?jobs|'
                          r'current.?jobs|aktuelle.?stellen|offres?.?d.?emploi|postes?.?ouverts|\bjobs\b|\bstellen\b', re.I)
JOB_HOST = re.compile(r'(?:^|[.-])(?:jobs?|stellen|karriere|careers?|jobportal|recruiting|bewerbung|emploi)(?:[.-]|$)', re.I)
NOT_JOBS = re.compile(r'benefit|news|blog|press|presse|medien|event|impressum|datenschutz|privacy|cookie|kontakt|contact|lehre|ausbildung|praktik|'
                      r'studium|bewerbungsprozess|application-process|erfahrungsberichte|mitarbeiterstimmen|login|logout', re.I)


def registrable(host):
    """The last two labels of a host name (karriere.acme.ch -> acme.ch): enough to tell a company's own subdomains apart from other sites."""
    labels = (host or '').lower().removeprefix('www.').split('.')
    return '.'.join(labels[-2:])


def careers_links(markup, base):
    """Links that look like the company's list of jobs, best first: a job system's address, a "jobs / open positions" link, then a general
    "careers" link. On the company's own site (any subdomain), or on a host that is named like a job site (stellen.lu.ch, jobs.acme.com)."""
    host = urllib.parse.urlsplit(base).hostname or ''
    scored = []
    for url, text in links(markup, base):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ('http', 'https') or re.search(r'\.(pdf|jpe?g|png|zip|docx?)$', parts.path, re.I):
            continue
        if ats.detect(url):
            if CAREER_WORDS.search(text):   # a job system link counts when it is worded as the careers link, not as any partner or widget
                scored.append((0, url))
            continue
        own = registrable(parts.hostname) == registrable(host)
        named = bool(JOB_HOST.search(parts.hostname or ''))
        if not (own or named) or NOT_JOBS.search(parts.path):
            continue
        strong = STRONG_WORDS.search(text) or STRONG_WORDS.search(parts.path) or (named and not own)
        weak = CAREER_WORDS.search(text) or CAREER_WORDS.search(parts.path) or named
        if strong:
            scored.append((1, url))
        elif weak:
            scored.append((2, url))
    ordered = [url for _, url in sorted(dict.fromkeys(scored), key=lambda item: item[0])]
    return list(dict.fromkeys(ordered))[:5]


def _walk(value):
    if isinstance(value, dict):
        if str(value.get('@type', '')).lower() == 'jobposting' or 'JobPosting' in (value.get('@type') if isinstance(value.get('@type'), list) else []):
            yield value
        for inner in value.values():
            yield from _walk(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from _walk(inner)


def jsonld_jobs(markup, url):
    """The JobPosting entries a page publishes, in the common job shape (ats._job)."""
    jobs = []
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', markup, re.S | re.I):
        try:
            data = json.loads(html.unescape(block) if '&quot;' in block else block)
        except ValueError:
            continue
        for posting in _walk(data):
            title = ats.plain(str(posting.get('title') or ''))
            if not title:
                continue
            places = posting.get('jobLocation') or []
            places = places if isinstance(places, list) else [places]
            where = []
            for place in places:
                address = (place or {}).get('address') or {}
                if isinstance(address, str):
                    where.append(address)
                    continue
                country = address.get('addressCountry') or ''
                country = country.get('name', '') if isinstance(country, dict) else str(country)
                where.append(', '.join(part for part in (address.get('addressLocality'), COUNTRIES.get(country.upper(), country)) if part))
            remote = 'telecommute' in str(posting.get('jobLocationType') or '').lower()
            salary = posting.get('baseSalary') or {}
            value = salary.get('value') if isinstance(salary, dict) else None
            salary_text = ''
            if isinstance(value, dict) and (value.get('minValue') or value.get('maxValue')):
                salary_text = f"{salary.get('currency', '')} {value.get('minValue', '')}–{value.get('maxValue', '')}".strip()
            link = urllib.parse.urljoin(url, str(posting.get('url') or url))
            jobs.append(ats._job(link, title, '; '.join(w for w in where if w), link, str(posting.get('datePosted') or '')[:10],
                                 ats.plain(str(posting.get('description') or '')), remote, salary_text))
    return jobs


def _places():
    """Your places as one pattern (config/search.json), to find where a job page says the job is."""
    from ..paths import keyword_regex, load_search_config
    groups = (load_search_config().get('locations') or {})
    return keyword_regex([*groups.get('top_tier', []), *groups.get('country_wide', []), *groups.get('abroad', [])] or [r'(?!x)x'])


def job_from_page(markup, url):
    """A job from a page with no job data: the main heading is the title, the page text the description, the place is any of your places
    the text names. Rough on purpose: the crawl's title filter keeps only the roles you look for, and a page that is not a job is dropped by it."""
    heading = re.search(r'<h1[^>]*>(.*?)</h1>', markup, re.S | re.I)
    title = ats.plain(heading.group(1) if heading else (re.search(r'<title[^>]*>(.*?)</title>', markup, re.S | re.I) or [None, ''])[1])
    title = re.split(r'\s+[|\u2013\u2014-]\s+', title)[0].strip()
    if not 4 <= len(title) <= 120:
        return None
    body = re.sub(r'<(script|style|noscript|nav|header|footer)\b.*?</\1>', ' ', markup, flags=re.S | re.I)
    text = ats.plain(body)
    found = []
    for match in _places().finditer(text[:6000]):
        word = match.group(0).strip().title()
        if word not in found:
            found.append(word)
    return ats._job(url, title, ', '.join(found[:3]), url, '', text, bool(re.search(r'\bremote\b|home.?office', text[:3000], re.I)))


def job_links(markup, base):
    """Links on a listing page that look like single job pages of the same site."""
    host = (urllib.parse.urlsplit(base).hostname or '').removeprefix('www.')
    own = urllib.parse.urlsplit(base).path.rstrip('/')
    out = []
    for url, _ in links(markup, base):
        parts = urllib.parse.urlsplit(url)
        if (parts.hostname or '').removeprefix('www.') == host and JOB_PATH.search(parts.path) and parts.path.rstrip('/') != own:
            out.append(url.split('#')[0])
    return list(dict.fromkeys(out))[:MAX_JOB_PAGES]


def read_page(url, fetch=get_text):
    """Jobs a careers page publishes: its own data, or the data of the job pages it links to. Raises when the page cannot be read."""
    markup = fetch(url)
    jobs = jsonld_jobs(markup, url) or read_page_from(markup, url, fetch)
    return _asked(url, markup, jobs)


def fetch(slug):
    """The ats 'careers' feed: the jobs on the page this slug stands for; read again through the browser when the plain page has none."""
    url = decode(slug)
    jobs = read_page(url)
    show = renderer() if not jobs else None
    return read_page(url, show) if show else jobs


READER = 'auto'   # 'auto': Claude reads pages the rules cannot (ai/page_reader.py) when an AI is available; None: never; or a function (url, html) -> jobs (tests)


def reader():
    if READER != 'auto':
        return READER
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR'):
        return None
    from ..ai import page_reader
    return page_reader.read if page_reader.usable() else None


def _asked(url, markup, jobs):
    """Rules' jobs, unless they look like menu entries (none matches a role you look for) and a model can read the page: then its answer."""
    read = reader()
    if not read:
        return jobs
    if jobs:
        from ..ai import page_reader
        if page_reader.plausible(jobs):
            return jobs
    answer = read(url, markup)
    return jobs if answer is None else answer


RENDER = 'auto'   # 'auto': the headless browser (render.py) when Playwright is installed; None: never; or a function url -> html (tests)


def renderer():
    """The function that reads a page after its scripts ran, or None. Off with JOB_PILOTTO_RENDER=0 and in the end-to-end fixtures."""
    if RENDER != 'auto':
        return RENDER
    if os.getenv('JOB_PILOTTO_RENDER') == '0' or os.getenv('JOB_PILOTTO_FIXTURE_DIR'):
        return None
    from . import render
    return render.render if render.available() else None


def _look(page, link, fetch_page):
    """What one careers page offers: {'ats', 'slug'}, {'ats': 'careers', 'jobs'} (slug added by the caller), or None."""
    found = embedded_system(page)
    if found:
        return {'ats': found[0], 'slug': found[1]}
    jobs = jsonld_jobs(page, link) or read_page_from(page, link, fetch_page)
    if len(jobs) == 1 and jobs[0]['url'].rstrip('/') == link.rstrip('/'):
        jobs = []   # that link is one job's page, not the list of jobs
    jobs = _asked(link, page, jobs)
    return {'ats': 'careers', 'jobs': jobs} if jobs else None


def _shell(markup):
    """The page is mostly an empty frame that scripts fill in: little text, or a single-page-app marker."""
    text = re.sub(r'<[^>]+>', ' ', re.sub(r'<(script|style)\b.*?</\1>', ' ', markup, flags=re.S | re.I))
    return len(re.sub(r'\s+', ' ', text).strip()) < 800 or bool(re.search(r'id="(root|__next|app)"|__NEXT_DATA__|ng-version|data-reactroot', markup))


def _explore(start, home, fetch_page, show=None):
    """The careers links of a page, then (one level deeper) the job-list links of the best of them."""
    seen, queue = set(), [(link, 0) for link in careers_links(home, start)]
    while queue and len(seen) < 8:
        link, depth = queue.pop(0)
        if link in seen:
            continue
        seen.add(link)
        found = ats.detect(link)
        if found:
            return {'ats': found[0], 'slug': found[1]}
        try:
            page = fetch_page(link)
        except Exception:  # noqa: BLE001
            continue
        result = _look(page, link, fetch_page)
        if not result and show and _shell(page):   # the plain page is an empty frame: read this one page again after its scripts ran
            try:
                page = show(link)
                result = _look(page, link, show)
            except Exception:  # noqa: BLE001 — refused or no browser: nothing more to do
                pass
        if result:
            if result['ats'] == 'careers':
                try:
                    result['slug'] = encode(link)
                except ValueError:
                    continue
            return result
        if depth == 0:   # a general careers page: the list of jobs is usually one link further
            queue += [(deeper, 1) for deeper in careers_links(page, link) if deeper not in seen][:3]
    return None


def discover(website, fetch_page=get_text):
    """What a company website offers: {'ats', 'slug'} for an embedded job system, {'ats': 'careers', 'slug', 'jobs'} for a page with jobs,
    or None. Home page, the careers links on it, and one level deeper. A page that is only a shell (its jobs appear after scripts run) is
    read again through the browser when RENDER is set; a site that refuses is left alone."""
    if not own_site(website):
        return None
    website = website if '//' in website else f'https://{website}'
    try:
        home = fetch_page(website)
    except Exception:  # noqa: BLE001 — a site that is down or refuses is just "nothing found"
        return None
    # Only a link that looks like the careers link counts as the company's job system: a stray widget or partner link on the home page is not.
    show = renderer() if fetch_page is get_text else None
    found = _explore(website, home, fetch_page, show)
    if found or show is None:
        return found
    try:
        shown = show(website)
    except Exception:  # noqa: BLE001 — refused, not allowed or no browser: nothing more to do
        return None
    return _explore(website, shown, show)


def read_page_from(markup, url, fetch_page):
    """read_page for a page already fetched: the data of the job pages it links to, or (a page of plain text) the pages' own headings."""
    def one(link):
        try:
            page = fetch_page(link)
        except Exception:  # noqa: BLE001
            return []
        return jsonld_jobs(page, link) or [job for job in [job_from_page(page, link)] if job]
    with ThreadPoolExecutor(max_workers=6) as pool:
        found = [job for result in pool.map(one, job_links(markup, url)) for job in result]
    return list({job['url']: job for job in found}.values())
