#!/usr/bin/env python3
"""Source scout: grow the list of employer job feeds a few companies per run.

Each run
1. harvests candidate employers (seed list with Tier 1 first, Hacker News "Who is
   hiring?", the open hiring-without-whiteboards list, and employers already seen
   on jobs.ch),
2. probes a small batch of them for a public job feed (Greenhouse, Lever, Ashby,
   Workable, Recruitee, Personio, SmartRecruiters, plus Amazon and Netflix),
3. scores every feed it finds for quality (0-100) against the owner's goals,
4. registers useful feeds (Notion Employers & Sources + local table) so the
   4-hourly crawl includes them, and
5. sends one Telegram summary.

Progress lives in the table scout_candidates, so later runs continue where this
one stopped. Nothing here applies to jobs; it only finds where jobs are posted.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html import escape, unescape
import json
import os
from pathlib import Path
import re
import sys
import threading
import urllib.parse
import urllib.request

from . import contribute, employer_index, role_kinds, store, telegram, tgcard
from .notion import client as notion, cron_runs
from .paths import JOBS_DB, CONFIG, keyword_regex, load_search_config
from .sources import ats, careers, feeds

SEEDS = CONFIG / 'scout_seeds.json'
# Notion "Employers & Sources": one row per employer or job board (formerly Source Registry + Company Research).
EMPLOYERS_DB = os.getenv('NOTION_EMPLOYERS_DB', '')
DEFAULT_BATCH = 40      # candidates probed per run (15 until 3 Oct 2026: the queue then held 400+ names and moved too slowly)
HN_THREADS = 2          # Latest monthly "Who is hiring?" threads to read.
RECHECK_DAYS = {'low': 21, 'none': 90, 'watch': 7}   # watch: a careers page with no open jobs today, looked at again weekly
# Tier 1 feeds are crawled with this many matching roles anywhere: their Zurich/London roles come and go.
TIER1_MIN_RELEVANT = 3
SMALL_GUESS = 5   # a guessed feed with fewer jobs is checked against the company's own careers page (find_feed)
# Lists of software employers only: Hacker News "Who is hiring?", hiring-without-whiteboards, SwissDevJobs, and the seed lists unless the seed file
# says "tech_only": false (absent means true: every app copied the shipped tech list at first run). A search outside IT neither harvests nor probes
# them (6 Oct 2026: a photographer's runs checked Netflix, Stripe and Databricks while the AI's Geneva retail and watchmaking ideas waited in the
# queue). Wikidata, jobs.ch employers and the AI's ideas cover every trade.
TECH_LIST_ORIGINS = ('Hacker News', 'hiring-without-whiteboards', 'SwissDevJobs')
SEED_ORIGINS = ('Tier 1 seed', 'Seed list:')

TABLES = """
CREATE TABLE IF NOT EXISTS scout_candidates (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    origin TEXT NOT NULL,
    priority INTEGER NOT NULL,
    tier TEXT NOT NULL DEFAULT 'Standard',
    ats TEXT,
    slug TEXT,
    careers TEXT,
    website TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    quality INTEGER,
    stats_json TEXT,
    added_at TEXT NOT NULL,
    checked_at TEXT,
    next_check TEXT
);
CREATE TABLE IF NOT EXISTS feed_sources (
    ats TEXT NOT NULL,
    slug TEXT NOT NULL,
    company TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'Standard',
    quality INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    added_at TEXT NOT NULL,
    PRIMARY KEY (ats, slug)
);
"""
_SEARCH = load_search_config()
STACK = keyword_regex(_SEARCH['quality_stack_keywords'])
SWISS_OR_ZURICH = keyword_regex([*_SEARCH['locations']['top_tier'], *_SEARCH['locations']['country_wide'],
                                r'\bch\b'])
LOCATION_WORDS = keyword_regex([*_SEARCH['locations']['top_tier'], *_SEARCH['locations']['country_wide'],
                                *_SEARCH['locations']['abroad'], 'remote'])
ROLE_WORDS = keyword_regex(_SEARCH['role_keywords'])


def now():
    return datetime.now(timezone.utc)


def clean_name(name):
    """A company name as a person would write it: harvested text ('Acme|Senior SRE|Remote', 'Acme https://acme.io') is cut back."""
    name = re.split(r'\s*[|]\s*', re.sub(r'https?://\S+', ' ', name or ''), 1)[0]
    return re.sub(r'\s+', ' ', name).strip(' -–—:,;')[:60]


def key_for(name):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\b(ag|sa|gmbh|ltd|inc|llc|plc)\b', '', name.lower()))


def _get_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def _get_text(url):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode('utf-8', 'replace')


# ---------- candidate harvesting ----------

def seed_candidates(seeds):
    for entry in seeds['tier1_known']:
        yield dict(name=entry['name'], origin='Tier 1 seed', priority=100, tier='Tier 1',
                   ats=entry['ats'], slug=entry['slug'])
    for name in seeds['tier1']:
        yield dict(name=name, origin='Tier 1 seed', priority=95, tier='Tier 1')
    for entry in seeds['manual_watch']:
        yield dict(name=entry['name'], origin='Tier 1 seed (no public feed)', priority=90, tier='Tier 1',
                   careers=entry['careers'], status='manual')
    for region, names in seeds['regional'].items():
        for name in names:
            yield dict(name=name, origin=f'Seed list: {region}', priority=55)


def hacker_news_candidates(threads=HN_THREADS, get=_get_json):
    """Companies from recent 'Ask HN: Who is hiring?' posts that mention our places and matching roles.

    Uses the official Hacker News search API (hn.algolia.com)."""
    stories = get('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=hiring&hitsPerPage=6')
    stories = [s for s in stories['hits'] if 'who is hiring' in s['title'].lower()][:threads]
    for story in stories:
        thread = get(f"https://hn.algolia.com/api/v1/items/{story['objectID']}")
        for post in thread.get('children', []):
            text = unescape(post.get('text') or '')
            plain = re.sub(r'<[^>]+>', ' ', text)
            if not (LOCATION_WORDS.search(plain) and ROLE_WORDS.search(plain)):
                continue
            name = clean_name(re.split(r'\s[|\-–(]\s?|\s\(', plain.strip(), 1)[0])
            if not name or len(name) < 2 or len(name.split()) > 5:
                continue
            links = re.findall(r'href="([^"]+)"', text) + re.findall(r'https?://\S+', plain)
            found = next((ats.detect(link) for link in links if ats.detect(link)), None)
            yield dict(name=name, origin=f"Hacker News: {story['title'][-16:-1]}", priority=85 if found else 60,
                       ats=found[0] if found else None, slug=found[1] if found else None)


def whiteboards_candidates(get=_get_text):
    """Companies from the open list poteto/hiring-without-whiteboards located in the configured places (or remote)."""
    readme = get('https://raw.githubusercontent.com/poteto/hiring-without-whiteboards/main/README.md')
    for line in readme.splitlines():
        match = re.match(r'- \[([^\]]+)\]\(([^)]+)\) \| ([^|]+)', line)
        if not match or not LOCATION_WORDS.search(match.group(3)):
            continue
        name, url = match.group(1).strip(), match.group(2).strip()
        found = ats.detect(url)
        yield dict(name=name, origin='hiring-without-whiteboards', priority=70 if found else 35,
                   ats=found[0] if found else None, slug=found[1] if found else None, careers=url,
                   website=None if found else url)


def local_company_candidates(db):
    """Employers already seen on jobs.ch / TechTree / SwissDevJobs, with their careers link and website when known. They are Swiss
    employers by origin, so they go first: 85 with a known feed address, 75 otherwise."""
    for row in db.execute('SELECT name, careers_url, website FROM companies'):
        found = ats.detect(row['careers_url'] or '')
        yield dict(name=row['name'], origin='jobs.ch employer', priority=85 if found else 75,
                   ats=found[0] if found else None, slug=found[1] if found else None, careers=row['careers_url'],
                   website=row['website'] or None)


def swissdevjobs_candidates(get=_get_json):
    """Employers listed on SwissDevJobs (its public job list names each company and its website): Swiss tech employers by definition."""
    seen = set()
    for job in get('https://swissdevjobs.ch/api/jobsLight'):
        name, site = (job.get('company') or '').strip(), (job.get('companyWebsiteLink') or '').strip()
        if not name or name in seen:
            continue
        seen.add(name)
        yield dict(name=name, origin='SwissDevJobs employer', priority=88, website=f'https://{site}' if site and '//' not in site else site or None)


WIKIDATA_QUERY = """SELECT ?label ?site (MAX(?staff) AS ?employees) WHERE {
  ?c wdt:P17 wd:Q39; wdt:P31/wdt:P279* wd:Q4830453; wdt:P856 ?site; wdt:P1128 ?staff. FILTER(?staff >= 30)
  ?c rdfs:label ?label. FILTER(LANG(?label) = "en") } GROUP BY ?label ?site ORDER BY DESC(?employees) LIMIT 1500"""


def wikidata_candidates(get=_get_json):
    """Swiss companies with a website and at least 30 employees, from Wikidata's open SPARQL service (bigger first). Any trade: the
    probe then keeps only those whose careers page lists jobs for your roles in your places."""
    url = 'https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(WIKIDATA_QUERY)
    for row in get(url)['results']['bindings']:
        name, site = row['label']['value'], row['site']['value']
        staff = int(float(row.get('employees', {}).get('value', 0) or 0))
        yield dict(name=name, origin='Wikidata: Swiss companies', priority=60 if staff >= 200 else 50, website=site)


def skipped_origins(seeds, technical):
    """The origins (prefixes) a search does not harvest or probe: none for an IT search, the tech-only lists for any other."""
    if technical:
        return ()
    return TECH_LIST_ORIGINS + (SEED_ORIGINS if seeds.get('tech_only', True) else ())


def harvest(db, seeds, sources=None, skip=()):
    """Add unseen candidates; returns how many were new. Failing sources are skipped, and so are candidates whose origin is in `skip`."""
    db.executescript(TABLES)
    columns = {row[1] for row in db.execute('PRAGMA table_info(scout_candidates)')}
    if 'website' not in columns:
        db.execute('ALTER TABLE scout_candidates ADD COLUMN website TEXT')   # a table made before 3 Oct 2026
    if 'checked_with' not in columns:
        db.execute('ALTER TABLE scout_candidates ADD COLUMN checked_with TEXT')   # the readers that judged it (READERS), since 6 Oct 2026
    extra = [name for name in os.getenv('JOB_PILOTTO_EXCLUDED_COMPANIES', '').split(',') if name.strip()]
    excluded = {key_for(name.strip()) for name in seeds.get('excluded', []) + extra}
    known = {row['key'] for row in db.execute('SELECT key FROM scout_candidates')}
    if sources is None:
        # JOB_PILOTTO_FIXTURE_DIR (the end-to-end journey, desktop/e2e): the seeds only, no Hacker News or whiteboard crawl.
        sources = [lambda: seed_candidates(seeds)] if os.getenv('JOB_PILOTTO_FIXTURE_DIR') else [
            lambda: seed_candidates(seeds), hacker_news_candidates, whiteboards_candidates, lambda: local_company_candidates(db),
            swissdevjobs_candidates, wikidata_candidates]
        if skip and not os.getenv('JOB_PILOTTO_FIXTURE_DIR'):   # a search outside IT: the lists of software employers are not even read
            sources = [lambda: seed_candidates(seeds), lambda: local_company_candidates(db), wikidata_candidates]
    added = 0
    for source in sources:
        try:
            candidates = list(source())
        except Exception as error:
            print(f'Warning: candidate source skipped: {type(error).__name__}: {error}')
            continue
        for c in candidates:
            key = key_for(c['name'])
            if key in known and c.get('website'):   # a name first seen without an address (Hacker News) learns it from a catalog
                db.execute('UPDATE scout_candidates SET website = COALESCE(website, ?) WHERE key = ?', (c['website'], key))
            if not key or key in excluded or key in known or c['origin'].startswith(skip):
                continue
            known.add(key)
            db.execute("""INSERT INTO scout_candidates (key, name, origin, priority, tier, ats, slug, careers, website, status, added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (key, c['name'], c['origin'], c['priority'], c.get('tier', 'Standard'), c.get('ats'),
                        c.get('slug'), c.get('careers'), c.get('website'), c.get('status', 'pending'), now().isoformat(timespec='seconds')))
            added += 1
    db.commit()
    return added


# The code that decides whether an employer has a readable job feed: when it changes (a release with better readers), the employers an older
# version judged "no feed", "low" or "watch" are looked at again, a batch at a time, instead of waiting out their 21 or 90 days (owner, 6 Oct
# 2026: the employers probed while the readers were wrong stayed skipped). A fingerprint of the files, so no version has to be bumped by hand.
READER_FILES = ('sources/ats.py', 'sources/careers.py', 'sources/web_search.py', 'sources/render.py', 'scout.py')


def readers_version():
    import hashlib
    digest = hashlib.sha256()
    for name in READER_FILES:
        try:
            digest.update((Path(__file__).parent / name).read_bytes())
        except OSError:
            digest.update(name.encode())
    return digest.hexdigest()[:12]


READERS = readers_version()


def next_batch(db, size, skip=()):
    """The next candidates to probe, best first; a search outside IT skips those a tech-only list queued earlier (or before its roles changed)."""
    stamp = now().isoformat(timespec='seconds')
    where, params = skipping(skip)
    return [dict(row) for row in db.execute(f"""SELECT * FROM scout_candidates
        WHERE (status = 'pending' OR (status = 'manual' AND checked_at IS NULL)
           OR (status IN ('low', 'none', 'watch') AND (next_check <= ? OR COALESCE(checked_with, '') != ?))) {where}
        ORDER BY status IN ('low', 'none', 'watch') ASC, priority DESC, added_at ASC LIMIT ?   -- re-checks after names never checked""", (stamp, READERS, *params, size))]


def skipping(skip):
    """SQL (and its parameters) that leaves out the candidates whose origin starts with one of `skip`."""
    if not skip:
        return '', []
    return 'AND NOT (' + ' OR '.join('origin LIKE ?' for _ in skip) + ')', [origin + '%' for origin in skip]


# ---------- probing and quality ----------

STOP_WORDS = {'gmbh', 'sagl', 'ltd', 'inc', 'llc', 'plc', 'the', 'and', 'group', 'holding', 'switzerland', 'schweiz', 'suisse', 'international', 'solutions', 'services', 'systems', 'technologies', 'technology', 'software'}


def belongs_to(candidate, slug, jobs, exact):
    """A guessed feed is the company's: its slug is the whole name or the website's domain (`exact`), or its jobs name the rest of the
    company's name. "Stellar Alpina" must not take the feed `stellar` of another company; `Puzzle ITC` may take `puzzle` if its jobs say ITC."""
    if exact:
        return True
    words = [w for w in re.findall(r'[a-z0-9]+', candidate['name'].lower()) if len(w) >= 3 and w not in STOP_WORDS and w != slug.lower()]
    if not words:
        return False
    blob = ' '.join(f"{j.get('title', '')} {j.get('location', '')} {j.get('url', '')} {(j.get('description') or '')[:400]}" for j in jobs[:40]).lower()
    return any(word in blob for word in words)


JOB_SUBDOMAINS = ('jobs', 'careers', 'career', 'karriere')


def job_hosts(website):
    """The usual addresses of a company's job site (jobs.coop.ch, careers.manor.ch), from its website: tried when its home page links to no
    job system (6 Oct 2026: coop.ch led nowhere, jobs.coop.ch is SuccessFactors with 3,142 jobs)."""
    host = (urllib.parse.urlsplit(website if '//' in website else f'https://{website}').hostname or '').lower().removeprefix('www.')
    if not host or host.split('.')[0] in JOB_SUBDOMAINS:
        return []
    return [f'https://{sub}.{host}' for sub in JOB_SUBDOMAINS]


def find_feed(candidate, probe=ats.probe, discover=careers.discover, note=None, search=None, jobsch_lookup=None):
    """(ats, slug, jobs) for the candidate's public feed, or None. In order: the address already known; slugs guessed from the name and
    from the website's domain on the common job systems; then the website itself (an embedded job system, or a careers page with job data)."""
    if candidate.get('ats') and candidate.get('slug'):
        jobs = probe(candidate['ats'], candidate['slug'])
        if jobs:
            return candidate['ats'], candidate['slug'], jobs
    jobs_site = candidate.get('careers') or ''
    if jobs_site and careers.own_site(jobs_site) and candidate.get('status') != 'manual':   # its own job site, when known: read first
        page = discover(jobs_site)
        if page and (page.get('jobs') or page.get('empty')):
            return page['ats'], page['slug'], page.get('jobs') or []
        jobs = probe(page['ats'], page['slug']) if page else None
        if jobs:
            return page['ats'], page['slug'], jobs
    website = candidate.get('website') or ''
    website = website if careers.own_site(website) else ''   # a job board or network is not the employer's address
    names = ats.slug_guesses(candidate['name'])
    if website:
        names = names[:2]   # the first word alone ("Data" for Data Purpose AG) is a guess; with an address to go by it is left out
    exact_slugs = {*ats.slug_guesses(candidate['name'])[:2], *ats.domain_guesses(website)}
    guessed = None
    for slug in list(dict.fromkeys([*names, *ats.domain_guesses(website)]))[:6]:
        for system in ats.GUESSABLE:
            jobs = probe(system, slug)
            if jobs and belongs_to(candidate, slug, jobs, slug in exact_slugs):
                guessed = (system, slug, jobs)
                break
        if guessed:
            break
    # A guess with a handful of jobs may be another company of that name (Coop Suisse Romande took JOIN's "coop", 1 job, while its own
    # careers site runs SuccessFactors with 3,142: 6 Oct 2026). With the company's address known, its own careers page decides then.
    if guessed and (not website or len(guessed[2]) >= SMALL_GUESS):
        return guessed
    page = discover(website) if website else None
    for host in [] if page or not website else job_hosts(website):   # the home page led nowhere: the usual job site of that domain
        page = discover(host)
        if page:
            break
    # Nothing by name, website or the usual job hosts: the employer's page on jobs.ch, where Swiss employers post (6 Oct 2026: Manor, 287 jobs,
    # and its job site careers.manor.ch; coop.ch refuses automated visitors). Its own job site first, else its jobs.ch listings as its feed.
    if not page and not guessed and jobsch_lookup:
        try:
            board = jobsch_lookup(candidate['name'])
        except Exception:  # noqa: BLE001 — jobs.ch not answering leaves the other ways
            board = None
        if board:
            own = discover(board['site']) if board.get('site') and careers.own_site(board['site']) else None
            own_jobs = own and (own.get('jobs') or (own.get('ats') != 'careers' and probe(own['ats'], own['slug'])))
            if own_jobs:
                return own['ats'], own['slug'], own_jobs
            listed = probe('jobsch', board['slug'])
            if listed:
                return 'jobsch', board['slug'], listed
    # Nothing by name, website or the usual job hosts: a web search for "<company> jobs", as a person would (web_search.py), its results
    # read like any careers page. Once per employer per recheck period: a "none" is not looked at again for RECHECK_DAYS['none'].
    for url in [] if page or guessed or not search else search(candidate['name']):
        page = discover(url)
        if page and (page.get('jobs') or page.get('ats') != 'careers'):
            break
        page = None
    if page:
        if page.get('empty'):
            return guessed or (page['ats'], page['slug'], [])   # a careers page with no open jobs right now: watched, not dropped
        jobs = page.get('jobs') or probe(page['ats'], page['slug'])
        if jobs and (not guessed or len(jobs) > len(guessed[2])):
            return page['ats'], page['slug'], jobs
        if guessed:
            return guessed
        if note and page.get('ats') != 'careers':
            # A job system the page names that gave back nothing: no adapter, or one that does not fit this company's pages. Said out loud, because a
            # silent None looked like "this employer has no jobs" (Ringier on Umantis, 5 Oct 2026).
            note(page['ats'], page['slug'], 'no adapter' if page['ats'] not in ats.FETCHERS else 'read no jobs')
    return None


def quality(jobs):
    """Deterministic 0-100 score of how useful a feed is for this search, with its evidence."""
    relevant = [j for j in jobs if feeds.TITLES.search(j['title'])]
    preferred = [j for j in relevant if feeds.wanted_location(j)]
    swiss = [j for j in preferred if SWISS_OR_ZURICH.search(j['location'] or '')]
    stack = [j for j in relevant if STACK.search(j.get('description') or '')]
    cutoff = (now() - timedelta(days=90)).date().isoformat()
    fresh = [j for j in relevant if (j.get('date_posted') or '')[:10] >= cutoff] if relevant else []
    dated = [j for j in relevant if j.get('date_posted')]
    fresh_share = (len(fresh) / len(dated)) if dated else 0.5
    salary = any(j.get('salary') for j in preferred)
    # Up to 20 for matching roles anywhere, 40 for roles in preferred places, 10 each for Switzerland,
    # stack overlap with the CV, freshness and published salaries.
    score = (min(20, 4 * len(relevant)) + min(40, 10 * len(preferred)) + (10 if swiss else 0)
             + round(10 * (len(stack) / len(relevant) if relevant else 0)) + round(10 * fresh_share if relevant else 0)
             + (10 if salary else 0))
    places = sorted({(j['location'] or '').split(',')[0].strip() for j in preferred if j['location']})[:6]
    return min(100, score), {'jobs': len(jobs), 'relevant': len(relevant), 'preferred': len(preferred),
                             'swiss': len(swiss), 'stack_share': round(len(stack) / len(relevant), 2) if relevant else 0,
                             'salary_published': salary, 'places': places}


def board_url(system, slug):
    return {
        'greenhouse': f'https://job-boards.greenhouse.io/{slug}', 'lever': f'https://jobs.lever.co/{slug}',
        'ashby': f'https://jobs.ashbyhq.com/{slug}', 'workable': f'https://apply.workable.com/{slug}',
        'recruitee': f'https://{slug}.recruitee.com', 'personio': f'https://{slug}.jobs.personio.de',
        'smartrecruiters': f'https://jobs.smartrecruiters.com/{slug}', 'amazon': 'https://www.amazon.jobs',
        'netflix': 'https://explore.jobs.netflix.net/careers', 'teamtailor': f'https://{slug}.teamtailor.com/jobs',
        'join': f'https://join.com/companies/{slug}', 'workday': workday_url(slug) if system == 'workday' else '', 'umantis': f'https://{slug}.umantis.com/Jobs/All',
        'successfactors': f'https://{slug}/search/',
        'careers': careers.decode(slug) if system == 'careers' else '', 'jobsch': f'https://www.jobs.ch/en/companies/{slug}/'}[system]


def workday_url(slug):
    tenant, cluster, site = slug.split('.', 2)
    return f'https://{tenant}.{cluster}.myworkdayjobs.com/{site}'


# ---------- registry used by the 4-hourly crawl ----------

def excluded_companies(seeds=None):
    """Keys of companies this user never wants suggested or crawled (seed list + JOB_PILOTTO_EXCLUDED_COMPANIES)."""
    extra = [name for name in os.getenv('JOB_PILOTTO_EXCLUDED_COMPANIES', '').split(',') if name.strip()]
    return {key_for(name.strip()) for name in (seeds or {}).get('excluded', []) + extra}


def active_sources(db, tracker=None, static=(), index=()):
    """Feeds for feeds.scan: starter sources.json + the downloaded employer index + local feed_sources + active
    Notion Employers & Sources rows (the owner's own list)."""
    db.executescript(TABLES)
    skip = excluded_companies()
    sources = {(s.get('ats', 'greenhouse'), s.get('slug') or s['board']): dict(s)
               for s in employer_index.merge(static, index, lambda company: key_for(company) in skip)}
    for row in db.execute('SELECT ats, slug, company FROM feed_sources WHERE active = 1'):
        sources.setdefault((row['ats'], row['slug']), {'company': row['company'], 'ats': row['ats'], 'slug': row['slug']})
    if tracker:
        try:
            for name, system, slug in notion_feeds(tracker):
                sources.setdefault((system, slug), {'company': name, 'ats': system, 'slug': slug})
        except Exception as error:  # Notion down: crawl what we know locally.
            print(f'Warning: Employers & Sources not read: {type(error).__name__}: {error}')
    return list(sources.values())


def notion_feeds(tracker):
    """[(company, ats, slug)] for every Active Employers & Sources row with a crawlable feed."""
    found = []
    for page in tracker.query_database(EMPLOYERS_DB, {'property': 'Active', 'checkbox': {'equals': True}}):
        props = page['properties']
        system = (props.get('ATS', {}).get('select') or {}).get('name')
        slug = ''.join(t['plain_text'] for t in props.get('Slug', {}).get('rich_text', []))
        name = ''.join(t['plain_text'] for t in props['Company']['title'])
        if system in ats.FETCHERS and slug:
            found.append((name, system, slug))
    return found


def export_sources(tracker, path=CONFIG / 'sources.json', fetch=ats.fetch, today=None):
    """Write the shared starter list: config/sources.json plus every Active Employers & Sources feed.

    Only public facts go into git (company, ATS, board slug, open jobs, date checked); tiers, ratings,
    research notes and anything about your applications stay in your own Notion. Each feed is fetched
    once to confirm it answers; one that doesn't is left out and named in the result."""
    today = today or now().date().isoformat()
    existing = json.loads(path.read_text()) if path.exists() else []
    feeds_by_key = {}
    for entry in existing:
        system, slug = entry.get('ats', 'greenhouse'), entry.get('slug') or entry['board']
        feeds_by_key[(system, slug)] = entry['company']
    for name, system, slug in notion_feeds(tracker):
        feeds_by_key.setdefault((system, slug), name)

    def check(item):
        (system, slug), company = item
        try:
            return {'company': company, 'ats': system, 'slug': slug, 'jobs': len(fetch(system, slug)), 'checked': today}
        except Exception as error:  # noqa: BLE001 — a dead feed is reported, not fatal
            return {'company': company, 'ats': system, 'slug': slug, 'error': f'{type(error).__name__}: {error}'}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(check, feeds_by_key.items()))
    kept = sorted((r for r in results if 'error' not in r), key=lambda r: (r['company'].lower(), r['ats'], r['slug']))
    path.write_text(json.dumps(kept, indent=2, ensure_ascii=False) + '\n')
    return kept, [r for r in results if 'error' in r]


# ---------- the central index (published by the scout in the private ops repo) ----------

def relevant_roles(jobs):
    """Open engineering / IT roles of a feed by the central definition, each title counted once (the same role listed for
    several cities is one role): the honest number for the website, since `jobs` counts every posting of every kind."""
    return len({(j.get('title') or '').strip().lower() for j in jobs if feeds.wanted_title(j.get('title'))})


def job_places(jobs, limit=40):
    """Where a feed has matching roles: its most common location strings, so a client can skip feeds with none in
    its own places without downloading them."""
    counts = Counter((j.get('location') or '').strip()[:60] for j in jobs if feeds.TITLES.search(j['title']))
    return [place for place, _ in counts.most_common(limit + 1) if place][:limit]


MIN_INSTALLS = 2   # a contributed feed becomes a candidate when this many different installs sent it (the scout still verifies it)
FIT_MIN_INSTALLS = 5   # a role / region tag is published for a feed only when this many different installs matched it


def fetch_contributions(base_url, key, get=None):
    """The opt-in aggregate from the website (`GET /api/contributions`, Bearer key); [] when unavailable: never fatal."""
    def default_get(request):
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    request = urllib.request.Request(base_url.rsplit('/api/', 1)[0] + '/api/contributions',
                                     headers={'Authorization': f'Bearer {key}', 'User-Agent': ats.USER_AGENT})
    try:
        return [f for f in (get or default_get)(request).get('feeds', []) if isinstance(f, dict)]
    except Exception as error:  # noqa: BLE001
        print(f'Warning: pool contributions not read ({type(error).__name__}: {error})')
        return []


def fits(contribution):
    """Role and region tags backed by enough different installs; nothing rarer is ever published."""
    out = {name: sorted(tag for tag, n in (contribution.get(name) or {}).items() if n >= FIT_MIN_INSTALLS)
           for name in ('roles', 'regions')}
    return {name: tags for name, tags in out.items() if tags}


def build_index(db, starter=(), fetch=ats.fetch, today=None, workers=8, contributions=(), boards=(), swiss_titles=None):
    """Every feed we know (starter list + what this scout found), fetched once: [{company, ats, slug, tier, quality,
    jobs, checked}]. A feed that doesn't answer is left out (it comes back when it does); returns (feeds, failed)."""
    db.executescript(TABLES)
    today = today or now().date().isoformat()
    known = {(s.get('ats', 'greenhouse'), s.get('slug') or s['board']): {'company': s['company'], 'tier': 'Standard'}
             for s in starter}
    for row in db.execute('SELECT ats, slug, company, tier FROM feed_sources WHERE active = 1'):
        known[(row['ats'], row['slug'])] = {'company': row['company'], 'tier': row['tier']}
    board_keys = {(b['ats'], str(b['slug']).lower()) for b in boards}
    by_feed = {(c.get('ats'), c.get('slug')): c for c in contributions}
    for key, c in by_feed.items():   # what apps contributed: verified below like everything else
        if key not in known and key[0] in ats.FETCHERS and (c.get('installs') or 0) >= MIN_INSTALLS and c.get('company'):
            known[key] = {'company': str(c['company'])[:120], 'tier': 'Standard'}

    def check(item):
        (system, slug), meta = item
        try:
            jobs = fetch(system, slug)
            if swiss_titles is not None:   # for the market coverage: the titles of this feed's jobs in Swiss places
                swiss_titles.extend(j['title'] for j in jobs if SWISS.search(j.get('location') or ''))
            score, _ = quality(jobs)
            kind = 'board' if (system, slug.lower()) in board_keys else 'employer'   # a job board of many companies is not an employer
            entry = {'company': clean_name(meta['company']) or meta['company'], 'ats': system, 'slug': slug, 'kind': kind, 'tier': meta['tier'], 'quality': score,
                     'jobs': len(jobs), 'relevant': relevant_roles(jobs), 'checked': today, 'places': job_places(jobs),
                     'regions': contribute.regions_of([j.get('location') or '' for j in jobs] + (['remote'] if any(j.get('remote') for j in jobs) else []))}
            kinds = role_kinds.mix([j.get('title') for j in jobs])   # what it hires for: installs skip one with nothing of their kind
            if kinds:
                entry['kinds'] = kinds
            tags = fits(by_feed.get((system, slug), {}))
            if system == 'careers':   # how to read this page without AI, learned here: every install's crawl can use it
                from .sources import page_recipes
                recipe = page_recipes.load(careers.decode(slug), db)
                if recipe:
                    entry['recipe'] = recipe
            return {**entry, 'fits': tags} if tags else entry
        except Exception as error:  # noqa: BLE001 — a dead feed is reported, not fatal
            return {'company': meta['company'], 'ats': system, 'slug': slug, 'error': f'{type(error).__name__}: {error}'}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(check, known.items()))
    answered = [r for r in results if 'error' not in r]
    quiet = health(db, answered, today)
    kept = sorted((r for r in answered if (r['ats'], r['slug']) not in quiet), key=lambda r: (r['company'].lower(), r['ats'], r['slug']))
    return kept, [r for r in results if 'error' in r]


QUIET_DAYS = 90   # a feed with no role in our scope for this long leaves the published index (it stays known, and returns when it has roles)


def health(db, entries, today):
    """Record when each feed last had a role in scope; returns {(ats, slug)} of the feeds quiet for QUIET_DAYS (left out of the index)."""
    db.execute('CREATE TABLE IF NOT EXISTS feed_health (ats TEXT NOT NULL, slug TEXT NOT NULL, first_checked TEXT NOT NULL, '
               'last_relevant TEXT, PRIMARY KEY (ats, slug))')
    cutoff = (datetime.fromisoformat(today) - timedelta(days=QUIET_DAYS)).date().isoformat()
    quiet = set()
    for entry in entries:
        key = (entry['ats'], entry['slug'])
        db.execute('INSERT OR IGNORE INTO feed_health (ats, slug, first_checked) VALUES (?, ?, ?)', (*key, today))
        if entry.get('relevant'):
            db.execute('UPDATE feed_health SET last_relevant = ? WHERE ats = ? AND slug = ?', (today, *key))
        row = db.execute('SELECT first_checked, last_relevant FROM feed_health WHERE ats = ? AND slug = ?', key).fetchone()
        if (row[1] or row[0]) < cutoff:
            quiet.add(key)
    db.commit()
    return quiet


SWISS = re.compile(r'switzerland|schweiz|suisse|svizzera|z[uü]rich|gen[eè]v|genf|basel|\bbern\b|lausanne|\bzug\b|lugano|luzern|lucerne|winterthur|st\.? ?gallen', re.I)
# Fixed words for the market coverage (engineering and IT, the central scout's own scope): the same words are asked of jobs.ch.
MARKET_TERMS = ('devops', 'site reliability', 'platform engineer', 'cloud engineer', 'kubernetes', 'software engineer', 'data engineer',
                'security engineer', 'system engineer', 'backend', 'frontend', 'machine learning')


def market_coverage(titles, get=None, terms=MARKET_TERMS, pause=1.0):
    """[{term, ours, jobsch}]: open jobs in Swiss places whose title has the word, in our index vs jobs.ch's own total for it (None when
    jobs.ch did not answer). Indicative: jobs.ch also lists agencies and repeats, and our index holds employer feeds only."""
    import time
    get = get or _get_text
    lowered = [t.lower() for t in titles]
    out = []
    for term in terms:
        jobsch = None
        try:
            page = get('https://www.jobs.ch/en/vacancies/?' + urllib.parse.urlencode({'term': term}))
            found = re.search(r'(\d[\d,\u2019\'.]*)\s+jobs\b', page)
            jobsch = int(re.sub(r'\D', '', found.group(1))) if found else None
        except Exception as error:  # noqa: BLE001 — a count we cannot read is shown as unknown
            print(f'Warning: jobs.ch count for {term}: {type(error).__name__}')
        out.append({'term': term, 'ours': sum(1 for t in lowered if term in t), 'jobsch': jobsch})
        time.sleep(pause)
    return out


def run_headline(message):
    """What the run row and Recent activity say about this run: the card's title and its second line ("New employer sources · 7 checked · 2 new sources"). The title alone
    says nothing about the run (5 Oct 2026: the Notion row read "New employer sources (AI cost $0.003)")."""
    return ' · '.join(line for line in cron_runs.plain(message).split('\n')[:2] if line.strip())


def record_unread(db, unread):
    """Keep which job systems were named by a careers page but could not be read (table unread_systems: one row per system and company), and say so in the
    run's log with the vendor's count: the list of what is worth teaching next (an adapter, or a recipe learned once per vendor)."""
    db.execute('CREATE TABLE IF NOT EXISTS unread_systems (system TEXT NOT NULL, why TEXT NOT NULL, company TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY (system, company))')
    for system, why, company in unread:
        db.execute('INSERT OR REPLACE INTO unread_systems (system, why, company, seen_at) VALUES (?, ?, ?, ?)', (system, why, company, now()))
    if unread:
        counts = Counter(system for system, _, _ in unread)
        print('Unread job systems this run: ' + ', '.join(f'{system} ×{n}' for system, n in counts.most_common()) + ' (' + ', '.join(sorted({c for _, _, c in unread}))[:160] + ')')
    return Counter(system for system, _, _ in unread)


def central_stats(db, feeds_out, market=()):
    """The central scout's own numbers for the website's /intel page: no user data, only counts and its own source names."""
    from .ai import scout_ideas

    def scalar(sql):
        try:
            return db.execute(sql).fetchone()[0] or 0
        except Exception:  # noqa: BLE001 — a table this scout never made counts as 0
            return 0
    try:
        meta = {row[0]: row[1] for row in db.execute('SELECT key, value FROM scout_meta')}
    except Exception:  # noqa: BLE001
        meta = {}
    return {'feeds': len(feeds_out), 'jobs': sum(f.get('jobs') or 0 for f in feeds_out), 'relevant': sum(f.get('relevant') or 0 for f in feeds_out),
            'by_ats': dict(Counter(f['ats'] for f in feeds_out)), 'by_region': dict(Counter(r for f in feeds_out for r in f.get('regions') or [])),
            'queue': {row[0]: row[1] for row in db.execute('SELECT status, COUNT(*) FROM scout_candidates GROUP BY status')},
            'recipes': scalar('SELECT COUNT(*) FROM page_recipes'), 'page_reads': scalar('SELECT COUNT(*) FROM page_reads'),
            'recipes_broken': scalar('SELECT COUNT(*) FROM page_recipes WHERE broken_at IS NOT NULL'),
            'quiet': scalar(f"SELECT COUNT(*) FROM feed_health WHERE COALESCE(last_relevant, first_checked) < date('now', '-{QUIET_DAYS} days')"),
            'link_choices': scalar('SELECT COUNT(*) FROM link_choices'), 'commoncrawl': meta.get('commoncrawl', ''),
            'unread_systems': {row[0]: row[1] for row in db.execute('SELECT system, COUNT(*) FROM unread_systems GROUP BY system')} if scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = 'unread_systems'") else {},
            'ideas_at': meta.get('ideas_at', ''), 'ideas_note': meta.get('ideas_note', ''),
            'sources': [{'origin': s['origin'], 'probed': s['probed'], 'found': s['found']} for s in scout_ideas.origin_yield(db)[:25]],
            'market': list(market)}


def publish_index(feeds, url, key, send=None, stats=None):
    """Upload the index to the website worker (PUT, Bearer key), with the scout's own numbers. Raises when the service refuses it."""
    if not feeds:
        raise ValueError('nothing to publish: no feed answered')
    body = json.dumps({'feeds': feeds, 'generated': now().isoformat(timespec='seconds'), **({'stats': stats} if stats else {})}).encode()

    def put(request):
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status
    request = urllib.request.Request(url, data=body, method='PUT', headers={
        'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'User-Agent': ats.USER_AGENT})
    status = (send or put)(request)
    if status != 200:
        raise RuntimeError(f'index upload answered {status}')
    return len(feeds)


# ---------- Notion ----------

def _text(value):
    return {'rich_text': [{'text': {'content': (value or '')[:2000]}}]}


def research_links(name):
    query = urllib.parse.quote(name)
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return (f'https://www.glassdoor.com/Search/results.htm?keyword={query}',
            f'https://www.levels.fyi/companies/{slug}/salaries')


# Each check outcome as Employers & Sources' Feed status (config/notion_schema.json lists the options). 'watch' was missing until
# 6 Oct 2026: a careers page with no open jobs today failed its Notion write with KeyError: 'watch'.
FEED_STATUS = {'found': 'Feed found', 'low': 'Low relevance', 'manual': 'Manual watch', 'none': 'No public feed', 'watch': 'No open jobs'}


def write_notion(tracker, candidate, outcome):
    """One Employers & Sources row per candidate worth keeping (created or updated by company name)."""
    today = now().date().isoformat()
    glassdoor, levels = research_links(candidate['name'])
    status, system, slug, score, stats = (outcome.get(k) for k in ('status', 'ats', 'slug', 'quality', 'stats'))
    if status == 'none' and candidate['tier'] != 'Tier 1':
        return  # Keep the database focused: unfeedable standard companies are only tracked locally.
    feed_status = FEED_STATUS[status]
    props = {
        'Company': {'title': [{'text': {'content': candidate['name']}}]},
        'Kind': {'select': {'name': 'Employer'}}, 'Tier': {'select': {'name': candidate['tier']}},
        'Feed status': {'select': {'name': feed_status}}, 'Active': {'checkbox': status == 'found'},
        'Origin': _text(candidate['origin']), 'Glassdoor': {'url': glassdoor}, 'levels.fyi': {'url': levels},
        'Checked': {'date': {'start': today}},
    }
    if score is not None:
        props['Quality'] = {'number': score}
    if system:
        props.update({'ATS': {'select': {'name': system}}, 'Slug': _text(slug),
                      'Feed': {'url': board_url(system, slug)}, 'Careers': {'url': board_url(system, slug)}})
    elif candidate.get('careers'):
        props['Careers'] = {'url': candidate['careers']}
    if stats:
        props.update({'Cities': _text(', '.join(stats['places'])), 'Relevant roles': {'number': stats['relevant']},
                      'In preferred places': {'number': stats['preferred']},
                      'Notes': _text(f"{stats['jobs']} postings; {stats['relevant']} matching; {stats['preferred']} in "
                                     f"preferred places ({stats['swiss']} in your countries or cities); stack overlap "
                                     f"{int(stats['stack_share'] * 100)}%"
                                     + ('; salaries published' if stats['salary_published'] else ''))})
    if status == 'found':
        props.update({'Integration': {'select': {'name': 'Working'}}, 'Added': {'date': {'start': today}}})
    existing = tracker.query_database(EMPLOYERS_DB, {'property': 'Company', 'title': {'equals': candidate['name']}})
    if existing:
        tracker.update_page(existing[0]['id'], props)
    else:
        tracker.create_page(EMPLOYERS_DB, props)


# The employers are checked in parallel threads: print() writes the text and its newline separately, so two lines could join
# ("…Hochschule BernScout: checked 6 of 15", 6 Oct 2026). One locked write per line, with its count.
PROGRESS_LOCK = threading.Lock()


def progress_line(text):
    sys.stdout.write(f'{text}\n')
    sys.stdout.flush()


# ---------- one run ----------

def ai_ideas(db, harvest_sources=None):
    """Claude's ideas for new candidates (every run), or None: off, no AI available, tests that pass their own
    harvest sources, or a failure (the scout then simply carries on with the usual sources)."""
    from . import features
    from .ai import engine, scout_ideas
    if harvest_sources is not None or os.getenv('JOB_PILOTTO_FIXTURE_DIR') or not features.enabled('scout_ai') or not engine.ready():
        return None
    try:
        found = scout_ideas.run(db, load_search_config())
    except Exception as error:  # noqa: BLE001 — the ideas are a bonus: a failed call must never stop the scout
        print(f'Warning: scout ideas skipped: {type(error).__name__}: {error}')
        return None
    if found:
        print(f"Scout ideas: {found['companies']} companies and {found['directories']} from company lists. {found['note']}")
    return found


def run(db, batch=DEFAULT_BATCH, tracker=None, seeds=None, probe=ats.probe, harvest_sources=None, workers=6, static=None):
    """Harvest, probe one batch, register what is useful. Returns (summary dict, list of outcomes).
    A board already crawled is a duplicate: the starter list (`static`, default config/sources.json), the feeds registered here and the Active Employers & Sources rows."""
    seeds = seeds or json.loads(SEEDS.read_text())
    if static is None:
        starter = CONFIG / 'sources.json'
        static = json.loads(starter.read_text()) if starter.exists() else []
    # Each step says so as it starts: a run takes minutes, and the app's live log shows these lines ("Nothing to show yet" for four
    # minutes was the owner's find of 5 Oct 2026).
    from .ai import scout_ideas
    skip = skipped_origins(seeds, scout_ideas.technical(load_search_config()))
    print('Scout: reading the employer lists…' if not skip else
          'Scout: reading the employer lists (your roles are outside IT, so the tech company lists are left out)…')
    added = harvest(db, seeds, harvest_sources, skip)
    print(f'Scout: {added} new candidate(s) from the lists; asking the AI for ideas…')
    ideas = ai_ideas(db, harvest_sources)
    if ideas:
        added += harvest(db, seeds, [lambda: ideas['candidates']], skip)
    candidates = next_batch(db, batch, skip)
    print(f'Scout: checking {len(candidates)} employer(s)…')
    active = {(s.get('ats', 'greenhouse'), s.get('slug') or s['board']) for s in active_sources(db, tracker, static)}
    active |= {(r['ats'], r['slug']) for r in db.execute('SELECT ats, slug FROM feed_sources')}   # also one switched off: it is not new

    # A web search for an employer's own job site, when a key allows it (web_search.py); never for the end-to-end journey's fixtures.
    from .sources import web_search
    language = next((loc.get('language') for loc in (load_search_config().get('google_jobs') or {}).get('locations') or [] if isinstance(loc, dict)), '')
    search = None if harvest_sources is not None or os.getenv('JOB_PILOTTO_FIXTURE_DIR') or not web_search.provider() else \
        (lambda name: web_search.job_sites(name, language))
    if search:
        print(f'Scout: employers with no job site found are looked up with a web search ({web_search.provider()}).')
    # jobs.ch for an employer with no job site we can read: Swiss places only (it lists Swiss employers), never for the fixtures.
    from .sources import boards as job_boards
    lookup = None if harvest_sources is not None or os.getenv('JOB_PILOTTO_FIXTURE_DIR') or job_boards.swiss_place_word(load_search_config()) is None \
        else (lambda name: ats.jobsch_find(name, key_for))
    unread = []   # job systems a careers page named that could not be read: (system, why, company)

    done = []

    def check(candidate):
        try:
            return check_one(candidate)
        finally:
            with PROGRESS_LOCK:
                done.append(candidate['name'])
                progress_line(f"Scout: checked {len(done)} of {len(candidates)}: {candidate['name']}")

    def check_one(candidate):
        if candidate['status'] == 'manual':
            return {'status': 'manual'}
        found = find_feed(candidate, probe, note=lambda system, slug, why: unread.append((system, why, candidate['name'])), search=search,
                          jobsch_lookup=lookup)
        if not found:
            return {'status': 'none'}
        system, slug, jobs = found
        if not jobs:
            return {'status': 'watch', 'ats': system, 'slug': slug}
        score, stats = quality(jobs)
        useful = stats['preferred'] >= 1 or (candidate['tier'] == 'Tier 1' and stats['relevant'] >= TIER1_MIN_RELEVANT)
        status = 'duplicate' if (system, slug) in active else ('found' if useful else 'low')
        return {'status': status, 'ats': system, 'slug': slug, 'quality': score, 'stats': stats}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        outcomes = list(pool.map(check, candidates))
    record_unread(db, unread)

    stamp = now()
    for candidate, outcome in zip(candidates, outcomes):
        status = 'found' if outcome['status'] == 'duplicate' else outcome['status']
        next_check = (stamp + timedelta(days=RECHECK_DAYS[status])).isoformat(timespec='seconds') \
            if status in RECHECK_DAYS else None
        db.execute("""UPDATE scout_candidates SET status=?, ats=COALESCE(?, ats), slug=COALESCE(?, slug), quality=?,
            stats_json=?, checked_at=?, next_check=?, checked_with=? WHERE key=?""",
                   (status, outcome.get('ats'), outcome.get('slug'), outcome.get('quality'),
                    json.dumps(outcome.get('stats')) if outcome.get('stats') else None,
                    stamp.isoformat(timespec='seconds'), next_check, READERS, candidate['key']))
        if outcome['status'] == 'found':
            db.execute("""INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at)
                VALUES (?, ?, ?, ?, ?, ?)""", (outcome['ats'], outcome['slug'], candidate['name'], candidate['tier'],
                                               outcome['quality'], stamp.isoformat(timespec='seconds')))
        db.commit()
        if tracker and outcome['status'] != 'duplicate':
            try:
                write_notion(tracker, candidate, outcome)
            except Exception as error:
                print(f"Warning: Notion not updated for {candidate['name']}: {type(error).__name__}: {error}")

    where, params = skipping(skip)
    queued = db.execute(f"SELECT COUNT(*) FROM scout_candidates WHERE status = 'pending' {where}", params).fetchone()[0]
    total_feeds = db.execute('SELECT COUNT(*) FROM feed_sources WHERE active = 1').fetchone()[0]
    # Each run checks names it never checked before (pending), and only re-checks one whose wait is over (RECHECK_DAYS): said in the card, so
    # "15 checked" is never read as the same list again (6 Oct 2026).
    first = sum(1 for c in candidates if not c.get('checked_at'))
    return {'checked': len(candidates), 'first_time': first, 'harvested': added, 'queued': queued, 'total_feeds': total_feeds,
            'ideas': {k: ideas[k] for k in ('companies', 'directories', 'note')} if ideas else None}, \
        list(zip(candidates, outcomes))


def telegram_summary(summary, results):
    found = sorted([(c, o) for c, o in results if o['status'] == 'found'], key=lambda x: -x[1]['quality'])
    counts = {s: sum(1 for _, o in results if o['status'] == s) for s in ('none', 'low', 'manual', 'duplicate', 'watch')}
    blocks = []
    for i, (c, o) in enumerate(found, 1):
        s = o['stats']
        tier = ' · Tier 1' if c['tier'] == 'Tier 1' else ''
        places = s['places'][:3]
        blocks.append(tgcard.block(
            f"{i}. {escape(c['name'])} · Source quality {o['quality']}{tier}",
            escape(tgcard.dot(f"{s['relevant']} matching roles", f"{s['preferred']} in preferred locations")),
            tgcard.fact('Location' if len(places) == 1 else 'Locations', ', '.join(places)),
            tgcard.fact('Platform', o['ats'].capitalize())))
    if not found:
        blocks.append('No new useful feeds in this batch.')
    detail = [f"{counts['none']} without a job feed we can read (their own job site, or jobs.ch)", f"{counts['low']} low relevance"]
    if counts['watch']:
        detail.append(f"{counts['watch']} careers page{'s' if counts['watch'] != 1 else ''} with no open jobs today (watched weekly)")
    if counts['manual']:
        detail.append(f"{counts['manual']} Tier 1 on manual watch")
    if summary.get('ideas'):
        ideas = summary['ideas']
        blocks.append(tgcard.block('New ideas', escape(f"{ideas['companies']} companies and {ideas['directories']} from company lists queued"),
                                   escape(ideas['note'])))
    rest = tgcard.dot(*detail, f"{summary['total_feeds']} feeds crawled", f"{summary['queued']} candidates queued",
                      f"{summary['harvested']} new candidates found" if summary['harvested'] else '')
    blocks.append(tgcard.block('Not added', escape(rest)))
    plural = 's' if len(found) != 1 else ''
    first = summary.get('first_time')
    again = summary['checked'] - first if first is not None else 0
    return tgcard.card('New employer sources', tgcard.dot(f"{summary['checked']} checked", f"{first} new to the search" if first is not None else '',
                                                         f"{again} checked again after their wait" if again else '', f"{len(found)} new source{plural}"), blocks,
                       emoji='🔎', footer='Source quality measures the source, not your job fit.')


def report_ai_cost(side):
    """Print what this run's AI calls cost, and write {usd, calls} to JOB_PILOTTO_AI_COST_FILE when set (the central scout's workflow
    reports it to the owner's /ai-cost page). Always written when asked, even $0: a job that spent nothing must still show up."""
    usd, calls = float(side.get('usd') or 0), int(side.get('done') or 0)
    print(f'AI cost of this scout run: ${usd:.3f} in {calls} call(s)')
    target = os.getenv('JOB_PILOTTO_AI_COST_FILE')
    if target:
        Path(target).write_text(json.dumps({'usd': round(usd, 6), 'calls': calls}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=JOBS_DB)
    parser.add_argument('--batch', type=int, default=DEFAULT_BATCH, help='candidates probed per run')
    parser.add_argument('--send', action='store_true', help='send the summary to Telegram')
    parser.add_argument('--log-run', action='store_true', help='log this run to Notion ⏱️ Search runs (the desktop app does)')
    parser.add_argument('--publish-index', action='store_true',
                        help='the central scout: after the run, verify every feed and upload the employer index '
                             '(needs INDEX_PUBLISH_KEY; URL: JOB_PILOTTO_INDEX_URL or the default)')
    parser.add_argument('--export-sources', action='store_true',
                        help='write config/sources.json: the shared starter list of verified public feeds '
                             '(sources.json + Active Employers & Sources rows); needs NOTION_TOKEN')
    args = parser.parse_args()
    if args.export_sources:
        tracker = notion.Tracker.from_env()
        if not tracker:
            raise SystemExit('--export-sources reads Employers & Sources: set NOTION_TOKEN')
        kept, failed = export_sources(tracker)
        print(f'Wrote {len(kept)} feeds ({sum(k["jobs"] for k in kept):,} open jobs) to config/sources.json')
        for item in failed:
            print(f"  left out {item['company']} ({item['ats']}:{item['slug']}): {item['error']}")
        return 0
    from .features import disabled
    if disabled('scout'):
        print('Source scout is off (JOB_PILOTTO_DISABLE includes scout).')
        return 0
    tracker = notion.Tracker.from_env()
    logged = tracker and (args.send or args.log_run)
    if logged:
        cron_runs.auto_begin(tracker)  # the scout's ⏱️ Search runs row opens when it starts
    log = cron_runs.new_run('scout')
    with store.connect(args.db) as db:
        summary, results = run(db, args.batch, tracker)
        if args.publish_index:
            key = os.getenv('INDEX_PUBLISH_KEY')
            if not key:
                raise SystemExit('--publish-index needs INDEX_PUBLISH_KEY')
            index_url = os.getenv('JOB_PILOTTO_INDEX_URL') or employer_index.URL
            contributions = fetch_contributions(index_url, key)
            swiss_titles = []
            feeds_out, failed = build_index(db, json.loads((CONFIG / 'sources.json').read_text()), contributions=contributions,
                                            boards=json.loads(SEEDS.read_text()).get('boards', []), swiss_titles=swiss_titles)
            stats = central_stats(db, feeds_out, market_coverage(swiss_titles))
            count = publish_index(feeds_out, index_url, key, stats=stats)
            print('Market coverage (our index / jobs.ch): ' + ', '.join(f"{m['term']} {m['ours']}/{m['jobsch']}" for m in stats['market']))
            print(f'Published {count} feeds to the employer index ({len(failed)} did not answer)')
    from .ai import cost as ai_cost
    if ai_cost.SIDE:   # AI ideas, link picks and page reads of this scout run: logged like any AI step
        log['sources'] = dict(ai_cost.SIDE)
    report_ai_cost(ai_cost.SIDE)
    message = telegram_summary(summary, results)
    log['headline'] = run_headline(message)
    log['subject'] = cron_runs.counted(sum(1 for _, outcome in results if outcome['status'] == 'found'), 'new feed')
    if args.send and not disabled('telegram'):
        print(message)
        telegram.send(message, *telegram.credentials())
    else:
        telegram.to_app(message)  # no Telegram: the desktop app shows the summary
    if logged:
        cron_runs.log_run(tracker, log)


if __name__ == '__main__':
    main()
