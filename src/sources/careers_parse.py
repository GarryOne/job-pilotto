"""Reading a careers page as text: the address <-> feed slug, links, which links look like a job list, and the jobs a page publishes itself
(schema.org JobPosting data), plus the numbered pages of a job list.

Split out of careers.py (pure move; import it through careers, never first). No network and no module state here: careers.py imports
and re-exports every name. Guarded by tests/test_careers.py and test_careers_paging.py.
"""
import html
import json
import re
import urllib.parse

from . import ats

MAX_JOB_PAGES = 40       # job pages read when the listing carries no data itself
CAREER_WORDS = re.compile(r'career|karriere|carri[eè]re|jobs?\b|stellen|offene.?stellen|vacanc|join.?us|work.?with.?us|emploi|recrut|lavora', re.I)
JOB_PATH = re.compile(r'/(?:job|jobs|stelle|stellen|vacanc\w*|position|positions|offre|offres|emploi|posting|opening|openings|career|careers|karriere|job-advertisement|advertisement)/[^/?#]+', re.I)
JOB_ID = re.compile(r'/(?:[^/]*-)?(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{5,}|[0-9a-z]{16,})$', re.I)
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




def links(markup, base):
    """(absolute address, link text) for every link on the page."""
    found = []
    for href, inner in re.findall(r'<a\b[^>]*?href=["\']([^"\'#][^"\']*)["\'][^>]*>(.*?)</a>', markup, re.S | re.I):
        found.append((urllib.parse.urljoin(base, html.unescape(href)), re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', inner))).strip()))
    return found



NO_JOBS = re.compile(r'(?:keine|leider keine|aktuell keine|zurzeit keine|derzeit keine)\s+(?:offenen?\s+)?(?:stellen|vakanzen|positionen|jobs)|'
                     r'no (?:open |current )?(?:positions|vacancies|openings|jobs)(?: (?:available|at the moment|right now))?|'
                     r'(?:aucun|pas de) (?:poste|offre)s? (?:ouvert|disponible|vacant)|nessuna posizione aperta', re.I)
STRONG_WORDS = re.compile(r'offene.?stellen|stellenangebot|stellenmarkt|stellenportal|open.?positions?|openings|vacanc|job.?overview|jobportal|all.?jobs|alle.?jobs|'
                          r'current.?jobs|aktuelle.?stellen|offres?.?d.?emploi|postes?.?ouverts|\bjobs\b|\bstellen\b', re.I)
JOB_HOST = re.compile(r'(?:^|[.-])(?:jobs?|stellen|karriere|careers?|jobportal|recruiting|bewerbung|emploi)(?:[.-]|$)|'
                      # Swiss job-portal software whose pages are built by scripts (read through the browser): Abacus, Prospective, dualoo, jobdesk, refline, HR4YOU
                      r'(?:^|\.)(?:abaservices\.ch|prospective\.ch|dualoo\.com|jobdesk\.ch|refline\.ch|hr4you\.org)$', re.I)
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


def _words(value):
    """A JSON-LD text field as text: sites give a string, a {"name": …}, or a list of either (7 Oct 2026: a list in addressLocality ended a
    whole Find new employers run with a TypeError)."""
    if isinstance(value, dict):
        return _words(value.get('name'))
    if isinstance(value, (list, tuple)):
        return ', '.join(part for part in (_words(item) for item in value) if part)
    return str(value).strip() if value not in (None, '') else ''


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
                if isinstance(place, str):
                    where.append(place)
                    continue
                address = (place.get('address') if isinstance(place, dict) else None) or {}
                if isinstance(address, list):
                    address = next((a for a in address if a), {})
                if isinstance(address, str):
                    where.append(address)
                    continue
                if not isinstance(address, dict):
                    continue
                country = _words(address.get('addressCountry'))
                where.append(', '.join(part for part in (_words(address.get('addressLocality')) or _words(address.get('addressRegion')), COUNTRIES.get(country.upper(), country)) if part))
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



def job_links(markup, base):
    """Links on a listing page that look like single job pages of the same site."""
    host = (urllib.parse.urlsplit(base).hostname or '').removeprefix('www.')
    own = urllib.parse.urlsplit(base).path.rstrip('/')
    out = []
    for url, _ in links(markup, base):
        parts = urllib.parse.urlsplit(url)
        if (parts.hostname or '').removeprefix('www.') == host and JOB_PATH.search(parts.path) and parts.path.rstrip('/') != own:
            out.append(url.split('#')[0])
    out = list(dict.fromkeys(out))
    # Single job pages end in an id (a UUID, a long number): when the page has some, those are the jobs and the rest is its menu
    # ("/karriere/trainee"). 6 Oct 2026: Migros's menu links filled the quota before its 31 job links on the page.
    with_id = [url for url in out if JOB_ID.search(urllib.parse.urlsplit(url).path.rstrip('/'))]
    return (with_id if len(with_id) >= 3 else out)[:MAX_JOB_PAGES]



MAX_LIST_PAGES = 20   # numbered pages of one job list read at most: each job on them is one more request to the site
PAGE_PAUSE_S = 0.5


def page_links(url, markup):
    """The numbered pages of the job list at `url` that it links to, in order: the same address with ?page=N (or &p=N, /page/N/), N >= 2.
    6 Oct 2026: Migros lists 1,335 jobs over 67 pages; only the first was read."""
    base = urllib.parse.urlsplit(url)
    found = {}
    for link, _ in links(markup or '', url):
        parts = urllib.parse.urlsplit(link)
        if parts.netloc != base.netloc:
            continue
        query = dict(urllib.parse.parse_qsl(parts.query))
        number = next((query[key] for key in ('page', 'p', 'pg', 'seite') if query.get(key, '').isdigit()), None)
        path = parts.path.rstrip('/')
        if number is None and (match := re.search(r'/page/(\d+)$', path)):
            number, path = match.group(1), path[:match.start()]
        if number and int(number) >= 2 and path == base.path.rstrip('/'):
            found.setdefault(int(number), link)
    return [found[n] for n in sorted(found)][:MAX_LIST_PAGES - 1]

