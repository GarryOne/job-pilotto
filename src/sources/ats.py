#!/usr/bin/env python3
"""Public job feeds of common applicant-tracking systems, normalised to one shape.

Every fetcher returns a list of dicts with: id, title, location, url, date_posted,
description (plain text, may be ''), remote (bool), salary (str, may be '').
Only documented public endpoints are used; they need no login.
"""
import functools
import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

USER_AGENT = 'JobPilotto/0.1 (personal job search; contact via GitHub GarryOne/job-pilotto)'
TIMEOUT = 20
DESCRIPTION_LIMIT = 12000


def _fixture(folder, url):
    """JOB_PILOTTO_FIXTURE_DIR (the end-to-end journey, desktop/e2e): a feed is read from <folder>/routes.json -> file instead of the network,
    so the test is the same every day. A URL with no route fails like an unreachable feed; nothing leaves the computer."""
    routes = json.loads((Path(folder) / 'routes.json').read_text())
    for part, name in routes.items():
        if part in url:
            return (Path(folder) / name).read_bytes()
    raise OSError(f'no fixture for {url}')


def _get(url):
    fixtures = os.getenv('JOB_PILOTTO_FIXTURE_DIR')
    if fixtures:
        return _fixture(fixtures, url)
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json, text/xml'})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def _json(url):
    return json.loads(_get(url))


def plain(markup):
    """HTML (possibly escaped twice) to plain text."""
    text = html.unescape(markup or '')
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', text))).strip()[:DESCRIPTION_LIMIT]


def _job(id, title, location, url, date_posted='', description='', remote=False, salary=''):
    return {'id': str(id), 'title': (title or '').strip(), 'location': (location or '').strip(),
            'url': url, 'date_posted': date_posted or '', 'description': description or '',
            'remote': bool(remote), 'salary': salary or ''}


def greenhouse(slug):
    data = _json(f'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true')
    return [_job(j['id'], j['title'], (j.get('location') or {}).get('name', ''), j['absolute_url'],
                 j.get('first_published') or j.get('updated_at', ''), plain(j.get('content')),
                 'remote' in ((j.get('location') or {}).get('name', '')).lower())
            for j in data['jobs']]


def lever(slug):
    data = _json(f'https://api.lever.co/v0/postings/{slug}?mode=json')
    jobs = []
    for j in data:
        categories = j.get('categories') or {}
        created = j.get('createdAt')
        posted = ''
        if created:
            from datetime import datetime, timezone
            posted = datetime.fromtimestamp(int(created) / 1000, timezone.utc).isoformat(timespec='seconds')
        salary = j.get('salaryRange') or {}
        salary_text = (f"{salary.get('currency', '')} {salary.get('min', '')}–{salary.get('max', '')}".strip()
                       if salary.get('min') else '')
        jobs.append(_job(j['id'], j.get('text'), categories.get('location', ''), j['hostedUrl'], posted,
                         (j.get('descriptionPlain') or '')[:DESCRIPTION_LIMIT],
                         (j.get('workplaceType') or '').lower() == 'remote', salary_text))
    return jobs


def ashby(slug):
    data = _json(f'https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true')
    jobs = []
    for j in data.get('jobs', []):
        if j.get('isListed') is False:
            continue
        compensation = j.get('compensation') or {}
        salary = (compensation.get('scrapeableCompensationSalarySummary')
                  or compensation.get('compensationTierSummary') or '')
        locations = [j.get('location') or ''] + [s.get('location', '') for s in j.get('secondaryLocations') or []]
        jobs.append(_job(j['id'], j.get('title'), '; '.join(l for l in locations if l), j['jobUrl'],
                         j.get('publishedAt', ''), (j.get('descriptionPlain') or '')[:DESCRIPTION_LIMIT],
                         j.get('isRemote') or (j.get('workplaceType') or '').lower() == 'remote',
                         salary if j.get('shouldDisplayCompensationOnJobPostings', True) else ''))
    return jobs


def smartrecruiters(slug):
    jobs, offset = [], 0
    while True:
        data = _json(f'https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset={offset}')
        for j in data.get('content', []):
            location = j.get('location') or {}
            where = ', '.join(p for p in (location.get('city'), location.get('country')) if p)
            jobs.append(_job(j['id'], j.get('name'), where, f"https://jobs.smartrecruiters.com/{slug}/{j['id']}",
                             j.get('releasedDate', ''), '', location.get('remote')))
        offset += 100
        if offset >= data.get('totalFound', 0) or offset >= 1000:
            return jobs


# Its postings list has no description: each posting's details are fetched for the jobs that pass the filters
# (feeds.scan), so stage 1 and the fit score can read them (without it, SmartRecruiters jobs stayed unscored).
def smartrecruiters_detail(slug, job_id):
    data = _json(f'https://api.smartrecruiters.com/v1/companies/{slug}/postings/{job_id}')
    sections = (data.get('jobAd') or {}).get('sections') or {}
    parts = [plain((sections.get(key) or {}).get('text')) for key in
             ('jobDescription', 'qualifications', 'additionalInformation', 'companyDescription')]
    return '\n\n'.join(part for part in parts if part)[:DESCRIPTION_LIMIT]


def workable(slug):
    data = _json(f'https://apply.workable.com/api/v1/widget/accounts/{slug}')
    jobs = []
    for j in data.get('jobs', []):
        where = ', '.join(p for p in (j.get('city'), j.get('country')) if p)
        jobs.append(_job(j.get('shortcode'), j.get('title'), where, j.get('url') or j.get('shortlink'),
                         j.get('published_on', ''), '', j.get('telecommuting')))
    return jobs


def recruitee(slug):
    data = _json(f'https://{slug}.recruitee.com/api/offers/')
    return [_job(j['id'], j.get('title'), j.get('location', ''), j.get('careers_url'), j.get('published_at', ''),
                 plain(j.get('description')), j.get('remote')) for j in data.get('offers', [])]


def personio(slug):
    root = ET.fromstring(_get(f'https://{slug}.jobs.personio.de/xml'))
    jobs = []
    for p in root.findall('position'):
        offices = [p.findtext('office') or ''] + [o.text or '' for o in p.findall('additionalOffices/office')]
        description = ' '.join(plain(d.findtext('value')) for d in p.findall('jobDescriptions/jobDescription'))
        jobs.append(_job(p.findtext('id'), p.findtext('name'), '; '.join(o for o in offices if o),
                         f"https://{slug}.jobs.personio.de/job/{p.findtext('id')}", p.findtext('createdAt') or '',
                         description[:DESCRIPTION_LIMIT], 'remote' in ' '.join(offices).lower()))
    return jobs


def teamtailor(slug):
    """Teamtailor's public RSS feed of a company's open jobs. The slug is the company's name on teamtailor.com, or its own careers address
    ("jobs.tamedia.ch"): many companies serve the same feed from their own domain, and the made-up name in the page's scripts is not theirs."""
    if '.' in slug:
        from . import careers
        if not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', slug) or not careers._public(slug):
            raise ValueError('not a public Teamtailor careers address')
        url = f'https://{slug}/jobs.rss'
    else:
        url = f'https://{slug}.teamtailor.com/jobs.rss'
    root = ET.fromstring(_get(url))
    ns = {'tt': 'https://teamtailor.com/locations'}
    jobs = []
    for item in root.iter('item'):
        places = []
        for place in item.findall('tt:locations/tt:location', ns):
            where = ', '.join(part for part in (place.findtext('tt:city', default='', namespaces=ns), place.findtext('tt:country', default='', namespaces=ns)) if part)
            if where:
                places.append(where)
        remote = (item.findtext('remoteStatus') or '').lower() in ('fully', 'hybrid')
        link = item.findtext('link') or ''
        jobs.append(_job(item.findtext('guid') or link, item.findtext('title'), '; '.join(places) or ('Remote' if remote else ''), link,
                         item.findtext('pubDate') or '', plain(item.findtext('description')), remote))
    return jobs


def join(slug):
    """JOIN (join.com): the company page carries its jobs in the page data, a few per page."""
    jobs, page = [], 1
    while page <= 20:
        markup = _get(f'https://join.com/companies/{slug}?page={page}').decode('utf-8', 'replace')
        found = re.search(r'__NEXT_DATA__[^>]*>(.*?)</script>', markup, re.S)
        state = json.loads(found.group(1))['props']['pageProps']['initialState']['jobs'] if found else {}
        for j in state.get('items') or []:
            city = j.get('city') or {}
            where = ', '.join(part for part in (city.get('cityName'), city.get('countryName')) if part)
            remote = (j.get('workplaceType') or '').upper() == 'REMOTE' or bool(j.get('remoteType'))
            jobs.append(_job(j.get('id'), j.get('title'), where, f"https://join.com/companies/{slug}/{j.get('idParam')}",
                             str(j.get('createdAt') or '')[:10], '', remote))
        if page >= int((state.get('pagination') or {}).get('pageCount') or 1):
            break
        page += 1
    return jobs


WORKDAY_PAGES = 2       # 20 jobs a page per search term: Workday sites list thousands, so each of the user's terms is searched
WORKDAY_ALL_PAGES = 10  # and the newest 200 with no term, for every search: what an employer hires for, not only what one user asks
WORKDAY_MAX_TERMS = 6


def workday_terms(search=None):
    """The user's own search phrases for a Workday search (6 Oct 2026: the reader searched only SRE and DevOps terms, the first user's, so a
    photographer could never see Cartier's or Piaget's boutique jobs). Their jobs-board phrases, else their role keywords as words."""
    if search is None:
        from ..paths import load_search_config
        search = load_search_config()
    phrases = [str(p) for p in search.get('jobs_board_search_queries') or []]
    if not phrases:
        phrases = [re.sub(r'\\[bwsd]|[\\^$()|?*+\[\]{}.]', ' ', str(word)).strip() for word in search.get('role_keywords') or []]
    return [p for p in dict.fromkeys(' '.join(p.split()) for p in phrases) if len(p) > 2][:WORKDAY_MAX_TERMS]


def _split_workday(slug):
    tenant, cluster, site = slug.split('.', 2)
    if not re.fullmatch(r'wd\d{1,2}', cluster) or not re.fullmatch(r'[\w-]+', tenant) or not re.fullmatch(r'[\w-]+', site):
        raise ValueError('not a Workday slug')
    return tenant, cluster, site


def workday(slug):
    """A Workday career site, slug `tenant.wdN.Site`. Its public search (the one its own page uses) is asked for each role term."""
    tenant, cluster, site = _split_workday(slug)
    base = f'https://{tenant}.{cluster}.myworkdayjobs.com'
    jobs, seen = [], set()
    for term, pages in [('', WORKDAY_ALL_PAGES), *((term, WORKDAY_PAGES) for term in workday_terms())]:
        for page in range(pages):
            body = json.dumps({'appliedFacets': {}, 'limit': 20, 'offset': 20 * page, 'searchText': term}).encode()
            request = urllib.request.Request(f'{base}/wday/cxs/{tenant}/{site}/jobs', data=body, headers={
                'User-Agent': USER_AGENT, 'Content-Type': 'application/json', 'Accept': 'application/json'})
            fixtures = os.getenv('JOB_PILOTTO_FIXTURE_DIR')
            if fixtures:
                data = json.loads(_fixture(fixtures, request.full_url))
            else:
                with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                    data = json.loads(response.read())
            postings = data.get('jobPostings') or []
            for j in postings:
                path = j.get('externalPath') or ''
                if path in seen or not path:
                    continue
                seen.add(path)
                where = j.get('locationsText') or ''
                jobs.append(_job(path, j.get('title'), where, f'{base}/{site}{path}', '', '', 'remote' in where.lower()))
            if len(postings) < 20:
                break
    return jobs


def successfactors(slug):
    """SAP SuccessFactors career sites ("Recruiting Marketing", e.g. careers.swissre.com): every open job in the site's public feed for
    search engines, /sitemal.xml (RSS with Google Base fields: location, employer). Slug: the site's host name."""
    if not re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+)+', slug or ''):
        raise ValueError('not a SuccessFactors site')
    root = ET.fromstring(_get(f'https://{slug}/sitemal.xml'))
    base = '{http://base.google.com/ns/1.0}'
    jobs = []
    for item in root.iter('item'):
        title = item.findtext('title') or ''
        where = item.findtext(f'{base}location') or ''
        title = re.sub(r'\s*\(' + re.escape(where) + r'\)\s*$', '', title) if where else title   # "Client Manager (Kuala Lumpur, MY)"
        link = item.findtext('link') or ''
        jobs.append(_job(item.findtext(f'{base}id') or item.findtext('guid') or link, title, where, link, '',
                         plain(item.findtext('description')), 'remote' in where.lower()))
    return jobs


def umantis(slug):
    """Haufe Umantis (common with Swiss employers and cantons): the HTML job list of `slug.umantis.com`, then each job's page for its
    place and text (the list shows neither). Slug: `recruitingapp-1234`."""
    if not re.fullmatch(r'recruitingapp-\d{2,6}', slug):
        raise ValueError('not an Umantis slug')
    base = f'https://{slug}.umantis.com'
    markup = _get(f'{base}/Jobs/All').decode('utf-8', 'replace')
    found = []
    for path, label in re.findall(r'href="(/Vacancies/\d+/Description/\d+)"[^>]*?aria-label="([^"]*)"', markup):
        if path not in [p for p, _ in found]:
            found.append((path, html.unescape(label)))
    from . import careers as page

    def one(item):
        path, title = item
        try:
            job = page.job_from_page(_get(base + path).decode('utf-8', 'replace'), base + path)
        except (urllib.error.URLError, OSError, ValueError):
            job = None
        return _job(path.split('/')[2], title, (job or {}).get('location', ''), base + path, '', (job or {}).get('description', ''),
                    bool(job and job['remote']))
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(one, found[:40]))


def careers(slug):
    """A company's own careers page (no job system behind it): see careers.py."""
    from . import careers as page
    return page.fetch(slug)


# Company career sites with a public JSON search (no standard ATS). Queried per role and place,
# because they list tens of thousands of jobs.
# What to search for and where comes from the user's Strategy (config/search.json: roles, and the places they target),
# not from one example profile: change the roles or places in Notion and the next crawl asks for those.
MAX_ROLES, MAX_PLACES = 4, 6   # each role x place is one request to a site that lists tens of thousands of jobs


def _strategy_terms():
    from ..notion.search_settings import terms
    from ..paths import load_search_config
    config = load_search_config()
    places = config.get('locations') or {}
    # Places abroad and whole countries first, a city only when there is nothing wider (a country's search covers its cities).
    where = terms([*(places.get('abroad') or []), *(places.get('country_wide') or [])]) or terms(places.get('top_tier'))
    return tuple(terms(config.get('role_keywords')))[:MAX_ROLES], tuple(p.title() for p in where)[:MAX_PLACES]


def search_roles():
    return _strategy_terms()[0]


def search_places():
    return _strategy_terms()[1]


def amazon(slug='amazon'):
    from datetime import datetime
    seen, jobs = set(), []
    for role in search_roles():
        for place in search_places():
            query = urllib.parse.urlencode({'base_query': role, 'loc_query': place, 'result_limit': 100})
            for j in _json(f'https://www.amazon.jobs/en/search.json?{query}').get('jobs', []):
                if j['id_icims'] in seen:
                    continue
                seen.add(j['id_icims'])
                try:
                    posted = datetime.strptime(j.get('posted_date', ''), '%B %d, %Y').date().isoformat()
                except ValueError:
                    posted = ''
                description = plain(' '.join(j.get(k) or '' for k in
                                             ('description', 'basic_qualifications', 'preferred_qualifications')))
                jobs.append(_job(j['id_icims'], j.get('title'), j.get('normalized_location') or j.get('city', ''),
                                 'https://www.amazon.jobs' + j['job_path'], posted, description))
    return jobs


def netflix(slug='netflix'):
    from datetime import datetime, timezone
    seen, jobs = set(), []
    for role in search_roles():
        query = urllib.parse.urlencode({'domain': 'netflix.com', 'query': role, 'num': 100})
        for j in _json(f'https://explore.jobs.netflix.net/api/apply/v2/jobs?{query}').get('positions', []):
            if j['id'] in seen:
                continue
            seen.add(j['id'])
            posted = (datetime.fromtimestamp(int(j['t_create']), timezone.utc).date().isoformat()
                      if j.get('t_create') else '')
            locations = '; '.join(j.get('locations') or [j.get('location', '')])
            jobs.append(_job(j['id'], j.get('name'), locations, j['canonicalPositionUrl'], posted,
                             plain(j.get('job_description')), 'remote' in locations.lower()))
    return jobs


# Boards whose list has no description, and how to fetch one posting's (ats -> fn(slug, job_id) -> text).
JOBSCH_PAGES = 15       # 20 postings a page on jobs.ch: up to 300 jobs of one employer
JOBSCH_COMPANY = re.compile(r'/companies/(\d+)-(?:\1-)?([a-z0-9-]+)')


def jobsch_company(link):
    """'27602-manor-ag' from a jobs.ch company link (/en/companies/27602-27602-manor-ag/), or ''."""
    match = JOBSCH_COMPANY.search(str(link or ''))
    return f'{match.group(1)}-{match.group(2).strip("-")}' if match else ''


def _postings(markup):
    """The JobPosting entries of a page's structured data (schema.org), wherever they sit in it."""
    def walk(value):
        if isinstance(value, dict):
            if value.get('@type') == 'JobPosting':
                yield value
            for inner in value.values():
                yield from walk(inner)
        elif isinstance(value, list):
            for inner in value:
                yield from walk(inner)
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', markup, re.S):
        try:
            yield from walk(json.loads(block))
        except ValueError:
            continue


def jobsch_find(name, key, get=None):
    """An employer on jobs.ch by name: {'slug', 'site'} (its company page id, and the job site that page links, or ''), or None. Only a
    listing whose employer has the same name key (`key`, the scout's: "Manor" and "Manor AG" are one) counts, never a similar name."""
    get = get or _get
    text = lambda raw: raw.decode('utf-8', 'replace') if isinstance(raw, bytes) else raw
    for job in _postings(text(get('https://www.jobs.ch/en/vacancies/?' + urllib.parse.urlencode({'term': name})))):
        org = job.get('hiringOrganization') or {}
        slug = jobsch_company(org.get('sameAs'))
        if slug and key(str(org.get('name') or '')) == key(name):
            page = text(get(f'https://www.jobs.ch/en/companies/{slug}/'))
            links = [link for link in re.findall(r'href="(https?://[^"]+)"', page) if 'jobs.ch' not in link and 'jobcloud' not in link]
            words = re.findall(r'[a-z0-9]{3,}', key(name))
            site = next((link for link in links if any(word in link.lower() for word in words)), '')
            return {'slug': slug, 'site': site}
    return None


def jobsch(slug):
    """One employer's jobs on jobs.ch ('27602-manor-ag'), for an employer whose own job site we cannot read (6 Oct 2026: Manor's careers site
    is a script app, coop.ch refuses automated visitors; both post every job on jobs.ch). The board's public search for its name, keeping
    only the postings of its company page (the id), page by page until a short page. robots.txt allows these pages."""
    company, _, words = slug.partition('-')
    out, seen = [], set()
    for page in range(1, JOBSCH_PAGES + 1):
        markup = _get('https://www.jobs.ch/en/vacancies/?' + urllib.parse.urlencode({'term': words.replace('-', ' '), 'page': page}))
        postings = list(_postings(markup.decode('utf-8', 'replace') if isinstance(markup, bytes) else markup))
        for job in postings:
            if jobsch_company((job.get('hiringOrganization') or {}).get('sameAs')).split('-')[0] != company or job.get('url') in seen:
                continue
            seen.add(job.get('url'))
            places = job.get('jobLocation') or []
            places = places if isinstance(places, list) else [places]
            where = ', '.join(dict.fromkeys(str((p.get('address') or {}).get('addressLocality') or (p.get('address') or {}).get('addressRegion') or '')
                                            for p in places if isinstance(p, dict)))
            ident = re.search(r'detail/([0-9a-f-]{36})', str(job.get('url') or ''))
            out.append(_job(ident.group(1) if ident else job.get('url'), job.get('title'), (where + ', Switzerland').strip(', '),
                            job.get('url'), str(job.get('datePosted') or '')[:10]))
        if len(postings) < 20:
            break
    return out


DETAILS = {'smartrecruiters': smartrecruiters_detail}
FETCHERS = {'greenhouse': greenhouse, 'lever': lever, 'ashby': ashby, 'smartrecruiters': smartrecruiters,
            'workable': workable, 'recruitee': recruitee, 'personio': personio,
            'teamtailor': teamtailor, 'join': join, 'workday': workday, 'umantis': umantis, 'successfactors': successfactors, 'careers': careers,
            'amazon': amazon, 'netflix': netflix, 'jobsch': jobsch}
# Standard systems a company slug can be guessed for; company sites are listed explicitly.
GUESSABLE = ('greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'personio', 'smartrecruiters', 'teamtailor', 'join')

# Hosts that reveal an ATS and its board slug inside a careers or job URL.
URL_PATTERNS = [
    # embed/job_board and embed/job_app are the same board: the job id is the token, not the path.
    ('greenhouse', r'(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_(?:board|app)\?for=)?([\w-]+)'),
    ('greenhouse', r'boards-api\.greenhouse\.io/v1/boards/([\w-]+)'),
    ('lever', r'jobs\.(?:eu\.)?lever\.co/([\w-]+)'),
    ('ashby', r'jobs\.ashbyhq\.com/([\w.-]+)'),
    ('smartrecruiters', r'(?:jobs|careers)\.smartrecruiters\.com/([\w-]+)'),
    ('workable', r'apply\.workable\.com/([\w-]+)'),
    ('recruitee', r'([\w-]+)\.recruitee\.com'),
    ('personio', r'([\w-]+)\.jobs\.personio\.(?:de|com)'),
    ('teamtailor', r'([\w-]+)\.teamtailor\.com'),
    ('join', r'join\.com/companies/([\w-]+)'),
    ('umantis', r'(recruitingapp-\d{2,6})\.umantis\.com'),
    ('workday', r'([\w-]+)\.(wd\d{1,2})\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([\w-]+)'),
]
IGNORED_SLUGS = {'embed', 'j', 'api', 'v1', 'jobs', 'careers', 'www', 'o', 'career', 'app', 'support', 'help', 'blog', 'static', 'tt', 'assets', 'scripts', 'cdn'}


def detect(url):
    """(ats, slug) found in a URL, or None."""
    for name, pattern in URL_PATTERNS:
        match = re.search(pattern, url or '', re.I)
        if match and match.group(1).lower() not in IGNORED_SLUGS:
            # Workday's board is three parts (tenant, cluster, site), written `tenant.wdN.Site`: letters, digits and dots only.
            return name, '.'.join(match.groups()) if name == 'workday' else match.group(1)
    return None


def slug_guesses(company):
    """Likely board slugs for a company name: 'Digitec Galaxus AG' -> digitecgalaxus, digitec-galaxus, digitec."""
    name = re.sub(r'\b(ag|sa|gmbh|ltd|limited|inc|llc|plc|se|group|holding|technologies|technology|labs)\b\.?', '',
                  company.lower())
    words = re.findall(r'[a-z0-9]+', name.replace('&', ' and '))
    if not words:
        return []
    guesses = [''.join(words), '-'.join(words), words[0]]
    return list(dict.fromkeys(g for g in guesses if len(g) >= 3))


def domain_guesses(website):
    """Likely board slugs from a company's web address: 'https://www.acme-tech.ch/en' -> acme-tech, acmetech, acme."""
    host = urllib.parse.urlsplit(website if '//' in (website or '') else f'//{website or ""}').hostname or ''
    labels = [label for label in host.lower().split('.') if label and label != 'www']
    if len(labels) < 2:
        return []
    name = labels[-2] if labels[-2] not in ('co', 'com', 'org', 'net') or len(labels) < 3 else labels[-3]
    words = [w for w in re.split(r'[^a-z0-9]+', name) if w]
    guesses = [name, ''.join(words), '-'.join(words), f'{name}-{labels[-1]}']
    return list(dict.fromkeys(g for g in guesses if len(g) >= 3))


def fetch(ats, slug):
    """Jobs from one feed; raises on network/format errors."""
    return FETCHERS[ats](slug)


@functools.lru_cache(maxsize=64)
def _board(ats, slug):
    """One board's jobs, fetched once per process (liveness checks for many jobs on one board)."""
    return tuple(fetch(ats, slug))


def _wanted(url):
    """The job id a board URL points at. A Greenhouse embed puts it in token or gh_jid; other links use the
    last path segment, which is also how a crawled row's URL is matched."""
    if 'greenhouse.io' in (url or ''):
        match = re.search(r'[?&](?:token|gh_jid)=(\d+)', url)
        if match:
            return match.group(1).lower()
    return (url or '').split('?')[0].rstrip('/').rsplit('/', 1)[-1].lower()


def _same_job(job, wanted):
    return job['id'].lower() == wanted or job['url'].split('?')[0].rstrip('/').rsplit('/', 1)[-1].lower() == wanted


def posting(url):
    """One posting fetched live from its job board by URL, or None when the board isn't supported or
    the posting is gone. Lets kit drafting and apply marking work for tracked jobs the crawl no
    longer holds (its SQLite is a cache; Notion keeps every tracked job)."""
    found = detect(url)
    if not found:
        return None
    wanted = _wanted(url)
    try:
        jobs = _board(*found)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError, ET.ParseError,
            json.JSONDecodeError, OSError):
        return None
    return next((job for job in jobs if _same_job(job, wanted)), None)


def _own_domain_board(url, company):
    """(ats, slug, job id) for a Greenhouse posting on the employer's own site ("n26.com/…?gh_jid=123"), found from the
    company name; only a board whose postings link back to that same site counts, so a guessed slug of another
    company can never say a job is gone. None when there's no such board."""
    jid = re.search(r'[?&]gh_jid=(\d+)', url or '')
    host = urllib.parse.urlsplit(url or '').hostname or ''
    if not jid or not host or not company:
        return None
    for slug in slug_guesses(company):
        try:
            jobs = _board('greenhouse', slug)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError,
                json.JSONDecodeError, OSError):
            continue
        if any(urllib.parse.urlsplit(job['url']).hostname == host for job in jobs):
            return 'greenhouse', slug, jid.group(1)
    return None


def is_live(url, company=''):
    """True if the posting is still on its job board, False if the board no longer lists it,
    None when we can't tell (unsupported board, or the board didn't answer). A Greenhouse posting on the
    employer's own site is checked on that employer's board when `company` is given."""
    found = detect(url)
    wanted = _wanted(url) if found else None
    if not found:
        own = _own_domain_board(url, company)
        if not own:
            return None
        found, wanted = own[:2], own[2]
    try:
        jobs = _board(*found)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError, ET.ParseError,
            json.JSONDecodeError, OSError):
        return None
    if not jobs:
        return None  # an empty board is more likely an outage than every job closing at once
    return any(_same_job(job, wanted) for job in jobs)


def probe(ats, slug):
    """Jobs if this (ats, slug) is a live board with at least one posting, else None."""
    try:
        jobs = fetch(ats, slug)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, KeyError, ET.ParseError,
            json.JSONDecodeError, OSError):
        return None
    return jobs or None
