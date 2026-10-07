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
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import escape, unescape
import json
import sqlite3
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
# A long queue is worked through faster and not made longer (owner, 7 Oct 2026: 609 ideas waited, the app probed 15 a run while each run added ~200):
# a run probes a sixth of the queue (40 to 100), and adds no new names while more than IDEAS_PAUSE wait.
MAX_BATCH, IDEAS_PAUSE = 100, 100


def batch_for(pending, asked=DEFAULT_BATCH):
    """How many candidates a run probes, for this many waiting: at least what was asked, more for a long queue."""
    return max(asked, min(MAX_BATCH, (pending or 0) // 6))


def pending_count(db):
    try:
        return db.execute("SELECT COUNT(*) FROM scout_candidates WHERE status = 'pending'").fetchone()[0]
    except sqlite3.OperationalError:   # before the first run made its table
        return 0
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
-- Which checked employers each Employers & Sources database already has a row for (sync_notion): a run without Notion, a failed
-- write or a new workspace leaves some out, and they are written later instead of staying only on this computer (6 Oct 2026).
CREATE TABLE IF NOT EXISTS notion_synced (
    db_id TEXT NOT NULL,
    key TEXT NOT NULL,
    PRIMARY KEY (db_id, key)
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


def _get_json(url, timeout=30):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def _get_text(url):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode('utf-8', 'replace')


# ---------- candidate harvesting ----------

# The central scout (python -m src scout --publish-index, job-pilotto-internal) keeps the full lists it publishes; an install ignores the copies
# of the lists the app shipped before 6 Oct 2026 (src/legacy_lists.py): those sources reach it through the central index now.
CENTRAL = False


def starter_list():
    """This install's own starter feeds (config/sources.json), without the ones the app used to ship (they come from the central index)."""
    sources = json.loads((CONFIG / 'sources.json').read_text()) if (CONFIG / 'sources.json').exists() else []
    if CENTRAL:
        return sources
    from .legacy_lists import SHIPPED_FEEDS
    return [s for s in sources if (s.get('ats', 'greenhouse'), s.get('slug') or s.get('board')) not in SHIPPED_FEEDS]


def seed_candidates(seeds):
    from .legacy_lists import SHIPPED_SEED_NAMES
    for c in _seed_candidates(seeds):
        if CENTRAL or c['name'] not in SHIPPED_SEED_NAMES:   # an install's copy of the old shipped seeds: central now
            yield c


def _seed_candidates(seeds):
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


WIKIDATA_TIMEOUT_S = 150         # the query takes about 65 s (7 Oct 2026); at the old 30 s it failed in every run
WIKIDATA_MAX_AGE = timedelta(days=7)   # the list of Swiss companies barely changes in a week


def wikidata_rows(get=_get_json, cache=None, clock=None):
    """Wikidata's answer, kept on disk for a week (data/cache/wikidata-companies.json): one slow query a week instead of one a run,
    and a failed or slow day reuses the last good list (said in the log) instead of leaving a search outside IT with no list at all."""
    from .paths import DATA
    cache = Path(cache) if cache else DATA / 'cache' / 'wikidata-companies.json'
    current = (clock or now)()
    try:
        kept = json.loads(cache.read_text())
        kept_at = datetime.fromisoformat(kept['at'])
    except (OSError, ValueError, KeyError, TypeError):
        kept, kept_at = None, None
    if kept and current - kept_at < WIKIDATA_MAX_AGE:
        return kept['rows']
    url = 'https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(WIKIDATA_QUERY)
    try:
        rows = get(url, timeout=WIKIDATA_TIMEOUT_S)['results']['bindings']
    except Exception as error:  # noqa: BLE001 — the copy from before, when there is one
        if not kept:
            raise
        print(f'Warning: Wikidata not reached ({type(error).__name__}): using its list from {kept_at.date().isoformat()}')
        return kept['rows']
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({'at': current.isoformat(), 'rows': rows}, ensure_ascii=False))
    return rows


def wikidata_candidates(get=_get_json, cache=None, clock=None):
    """Swiss companies with a website and at least 30 employees, from Wikidata's open SPARQL service (bigger first). Any trade: the
    probe then keeps only those whose careers page lists jobs for your roles in your places."""
    for row in wikidata_rows(get, cache, clock):
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
# version judged "no feed", "low" or "watch" are looked at again instead of waiting out their 21 or 90 days (owner, 6 Oct 2026: the employers
# probed while the readers were wrong stayed skipped). A fingerprint of that code only (src/sources/readers.py): the reader modules and the
# functions here that judge a site, without comments, docstrings or print lines, so a wording change elsewhere in this file wakes no one.
READER_FILES = ('sources/ats.py', 'sources/careers.py', 'sources/web_search.py', 'sources/render.py', 'scout.py')
JUDGES = ('belongs_to', 'job_hosts', 'find_feed', 'quality', 'relevant_roles', 'job_places')


def readers_version():
    from .sources.readers import code_fingerprint
    return code_fingerprint(READER_FILES, only={'scout.py': JUDGES})


READERS = readers_version()


def next_batch(db, size, skip=()):
    """The next candidates to probe, best first; a search outside IT skips those a tech-only list queued earlier (or before its roles changed).
    Names never checked come first, all of them; an employer checked before waits at the end, even when newer readers would judge it again
    (owner, 7 Oct 2026: a run of 92 checked 36 again and 4 new names while 548 waited)."""
    stamp = now().isoformat(timespec='seconds')
    where, params = skipping(skip)
    return [dict(row) for row in db.execute(f"""SELECT * FROM scout_candidates
        WHERE (status = 'pending' OR (status = 'manual' AND checked_at IS NULL)
           OR (status IN ('low', 'none', 'watch') AND (next_check <= ? OR COALESCE(checked_with, '') != ?))) {where}
        ORDER BY status IN ('low', 'none', 'watch') ASC,   -- names never checked first, then re-checks
                 (status IN ('low', 'none', 'watch') AND COALESCE(checked_with, '') != ?) DESC,   -- judged by older readers, then due by date
                 priority DESC, added_at ASC LIMIT ?""",
        (stamp, READERS, *params, READERS, size))]


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
        candidate.setdefault('found_site', url)   # the search's own find is kept even when it cannot be read (Hublot answers 403): opened by the person
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
        'careers': careers.decode(slug) if system == 'careers' else '', 'jobsch': f'https://www.jobs.ch/en/companies/{slug}/',
        'visit': slug}[system]   # a page read through the user's own visit: its address is the slug


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


MIN_INSTALLS = 1   # a contributed feed becomes a candidate when this many installs sent it; the scout verifies it either way. 1 since 6 Oct 2026
#                   (owner: grow the central employer list as much as possible): a job site's address is public company data, and one install's
#                   find (Coop, Migros, Manor on a photographer's Mac) now reaches every install the next night instead of waiting for a second.
OWN_MIN_INSTALLS = 3   # a feed only users added by hand (never found by a scout) becomes a candidate past this many installs: one person's own list stays theirs
FIT_MIN_INSTALLS = 5   # a role / region tag is published for a feed only when this many different installs matched it


def fetch_contributions(base_url, key, get=None, with_nofeed=False):
    """The opt-in aggregate from the website (`GET /api/contributions`, Bearer key); [] when unavailable: never fatal. With with_nofeed,
    (feeds, nofeed): also the employers installs found with no readable job site."""
    def default_get(request):
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    base = base_url.rsplit('/api/', 1)[0] + '/api/contributions'

    def pages(part, field):   # the site adds up in SQL and pages (`next`), so nothing is cut off as installs grow (7 Oct 2026)
        out, after = [], ''
        for _ in range(1000):
            query = urllib.parse.urlencode({'part': part, **({'after': after} if after else {})})
            answer = (get or default_get)(urllib.request.Request(f'{base}?{query}', headers={'Authorization': f'Bearer {key}', 'User-Agent': ats.USER_AGENT}))
            out += [item for item in answer.get(field, []) if isinstance(item, dict)]
            after = answer.get('next')
            if not after:
                return out
        return out
    try:
        feeds = pages('feeds', 'feeds')
        return (feeds, pages('nofeed', 'nofeed')) if with_nofeed else feeds
    except Exception as error:  # noqa: BLE001
        print(f'Warning: pool contributions not read ({type(error).__name__}: {error})')
        return ([], []) if with_nofeed else []


FIT_NAMES = ('roles', 'regions', 'countries', 'metros', 'families')   # finer labels since 7 Oct 2026, same floor
POOL_MIN_INSTALLS = 3   # outcome totals of a feed or board are published only past this many installs (k-anonymity)


def fits(contribution):
    """Role and region tags backed by enough different installs; nothing rarer is ever published. `quiet`: tags whose installs read the feed
    fine, FIT_MIN_INSTALLS of them or more, and none found a job there for that tag (7 Oct 2026): installs with that tag skip it."""
    out = {name: sorted(tag for tag, n in (contribution.get(name) or {}).items() if n >= FIT_MIN_INSTALLS) for name in FIT_NAMES}
    out = {name: tags for name, tags in out.items() if tags}
    quiet = {name: sorted(tag for tag, n in (contribution.get(f'quiet_{name}') or {}).items()
                          if n >= FIT_MIN_INSTALLS and not (contribution.get(name) or {}).get(tag)) for name in ('roles', 'families')}
    quiet = {name: tags for name, tags in quiet.items() if tags}
    return {**out, **({'quiet': quiet} if quiet else {})}


def pool_of(contribution):
    """What a feed led to across installs, published past POOL_MIN_INSTALLS: {installs, matched, applied, interview}, or None."""
    installs = int(contribution.get('installs') or 0)
    if installs < POOL_MIN_INSTALLS:
        return None
    out = contribution.get('out') or {}
    return {'installs': installs, 'matched': int(contribution.get('matched_installs') or 0), 'applied': int(out.get('applied') or 0),
            'interview': int(out.get('interview') or 0)}


def board_stats(boards):
    """Per job board, what it gives people by role kind, family, country and metro: [{board, installs, matched, by: {name: {tag: [installs,
    matched]}}}], each tag past POOL_MIN_INSTALLS only. Installs read it to say "gives a match to 6 in 10 people like you"."""
    out = []
    for board in boards or []:
        if not isinstance(board, dict) or int(board.get('installs') or 0) < POOL_MIN_INSTALLS:
            continue
        by = {}
        for name in FIT_NAMES:
            kept = {tag: [int(line.get('installs') or 0), int(line.get('matched') or 0)] for tag, line in (board.get(name) or {}).items()
                    if isinstance(line, dict) and int(line.get('installs') or 0) >= POOL_MIN_INSTALLS}
            if kept:
                by[name] = kept
        out.append({'board': board.get('board'), 'installs': int(board['installs']), 'matched': int(board.get('matched_installs') or 0), 'by': by})
    return out


def publish_summary(feeds, contributions, boards):
    """One line on what the pool added to this publish (7 Oct 2026: the log said only "Published N feeds"): feeds with labels, quiet marks and
    outcome totals, boards with stats, and the first quiet marks by label, so a wrong one can be traced."""
    labelled = sum(1 for f in feeds if any((f.get('fits') or {}).get(name) for name in FIT_NAMES))
    quiet = [(f['company'], tag) for f in feeds for tags in ((f.get('fits') or {}).get('quiet') or {}).values() for tag in tags]
    pooled = sum(1 for f in feeds if f.get('pool'))
    by_label = {}
    for company, tag in quiet:
        by_label.setdefault(tag, []).append(company)
    first = '; '.join(f"{tag}: {', '.join(names[:5])}{' …' if len(names) > 5 else ''}" for tag, names in sorted(by_label.items())[:8])
    return (f'Pool in this publish: {len(contributions)} shared feeds read, {labelled} feeds with labels, {len(quiet)} quiet marks, {pooled} with outcome totals, '
            f"{len(boards)} boards with stats{f' | quiet for {first}' if first else ''}")


def fetch_boards(base_url, key, get=None):
    """The pool's per-board totals (`GET /api/contributions?part=boards`); [] when unavailable."""
    def default_get(request):
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    request = urllib.request.Request(base_url.rsplit('/api/', 1)[0] + '/api/contributions?part=boards',
                                     headers={'Authorization': f'Bearer {key}', 'User-Agent': ats.USER_AGENT})
    try:
        return [b for b in (get or default_get)(request).get('boards', []) if isinstance(b, dict)]
    except Exception as error:  # noqa: BLE001
        print(f'Warning: pool board totals not read ({type(error).__name__}: {error})')
        return []


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
        installs = c.get('installs') or 0
        own_only = installs and (c.get('own_installs') or 0) >= installs
        if key not in known and key[0] in ats.FETCHERS and installs >= (OWN_MIN_INSTALLS if own_only else MIN_INSTALLS) and c.get('company'):
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
            pooled = pool_of(by_feed.get((system, slug), {}))
            if pooled:
                entry['pool'] = pooled
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
    failed = [r for r in results if 'error' in r]
    quiet, fresh = health(db, answered, today, failed)
    kept = sorted(({**r, 'fresh': fresh[(r['ats'], r['slug'])]} for r in answered if (r['ats'], r['slug']) not in quiet),
                  key=lambda r: (r['company'].lower(), r['ats'], r['slug']))
    return kept, failed


QUIET_DAYS = 90   # a feed with no open job of any kind for this long leaves the published index (it stays known, and returns when it lists jobs)


def health(db, entries, today, failed=()):
    """Each feed's freshness, kept from night to night: ({(ats, slug)} of feeds with no open job of any kind for QUIET_DAYS (left out of the
    index), {(ats, slug): fresh}). fresh = {ok: last read that worked, fails: failed reads in a row, jobs: open jobs now, trend: up/flat/down
    since the last read, new: last day it listed more jobs than before}.
    6 Oct 2026: a feed counted as alive only while it had a job in the central scout's own IT scope, so every shop, warehouse or care
    employer an install found would have left the list after 90 days. Now any open job keeps it, whatever the trade."""
    db.execute('CREATE TABLE IF NOT EXISTS feed_health (ats TEXT NOT NULL, slug TEXT NOT NULL, first_checked TEXT NOT NULL, '
               'last_relevant TEXT, PRIMARY KEY (ats, slug))')
    have = {row[1] for row in db.execute('PRAGMA table_info(feed_health)')}
    for column, kind in (('last_ok', 'TEXT'), ('fails', 'INTEGER DEFAULT 0'), ('jobs', 'INTEGER'), ('last_new', 'TEXT'), ('last_listed', 'TEXT')):
        if column not in have:
            db.execute(f'ALTER TABLE feed_health ADD COLUMN {column} {kind}')   # a table from before 6 Oct 2026
    cutoff = (datetime.fromisoformat(today) - timedelta(days=QUIET_DAYS)).date().isoformat()
    quiet, fresh = set(), {}
    for entry in failed:
        key = (entry['ats'], entry['slug'])
        db.execute('INSERT OR IGNORE INTO feed_health (ats, slug, first_checked) VALUES (?, ?, ?)', (*key, today))
        db.execute('UPDATE feed_health SET fails = COALESCE(fails, 0) + 1 WHERE ats = ? AND slug = ?', key)
    for entry in entries:
        key, jobs = (entry['ats'], entry['slug']), int(entry.get('jobs') or 0)
        db.execute('INSERT OR IGNORE INTO feed_health (ats, slug, first_checked) VALUES (?, ?, ?)', (*key, today))
        before = db.execute('SELECT jobs FROM feed_health WHERE ats = ? AND slug = ?', key).fetchone()[0]
        db.execute('UPDATE feed_health SET last_ok = ?, fails = 0, jobs = ?, last_new = CASE WHEN ? > COALESCE(jobs, 0) THEN ? ELSE last_new END, '
                   'last_listed = CASE WHEN ? > 0 THEN ? ELSE last_listed END, last_relevant = CASE WHEN ? THEN ? ELSE last_relevant END '
                   'WHERE ats = ? AND slug = ?', (today, jobs, jobs, today, jobs, today, bool(entry.get('relevant')), today, *key))
        row = db.execute('SELECT first_checked, last_listed, last_ok, fails, last_new FROM feed_health WHERE ats = ? AND slug = ?', key).fetchone()
        if (row[1] or row[0]) < cutoff:
            quiet.add(key)
        trend = 'flat' if before is None or before == jobs else 'up' if jobs > before else 'down'
        fresh[key] = {'ok': row[2], 'fails': row[3] or 0, 'jobs': jobs, 'trend': trend, 'new': row[4]}
    db.commit()
    return quiet, fresh


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


def dead_ends(db, shared=(), days=30):
    """[{key, company, host, last}] to publish: employers installs (shared) or this central scout found with no readable job site in the
    last `days` days. Installs skip them for 30 days (src/employer_index.central_nofeed)."""
    since = (now() - timedelta(days=days)).date().isoformat()
    out = {}
    for item in shared:
        key, last = str(item.get('key') or ''), str(item.get('last') or '')
        if re.fullmatch(r'[a-z0-9]{1,120}', key) and last >= since:
            out[key] = {'key': key, 'company': str(item.get('company') or '')[:120], 'host': item.get('host'), 'last': last[:10]}
    for row in db.execute("SELECT name, website, checked_at FROM scout_candidates WHERE status = 'none' AND checked_at >= ?", (since,)):
        key = key_for(row[0])
        if key and key not in out:
            host = re.sub(r'^https?://(www\.)?', '', row[1] or '').split('/')[0].lower() or None
            out[key] = {'key': key, 'company': str(row[0])[:120], 'host': host, 'last': str(row[2])[:10]}
    return list(out.values())[:5000]


def publish_index(feeds, url, key, send=None, stats=None, nofeed=None, boards=None):
    """Upload the index to the website worker (PUT, Bearer key), with the scout's own numbers. Raises when the service refuses it."""
    if not feeds:
        raise ValueError('nothing to publish: no feed answered')
    body = json.dumps({'feeds': feeds, 'generated': now().isoformat(timespec='seconds'), **({'stats': stats} if stats else {}),
                       **({'nofeed': nofeed} if nofeed else {}), **({'boards': boards} if boards else {})}).encode()

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


def mark_synced(db, key):
    db.execute('INSERT OR IGNORE INTO notion_synced (db_id, key) VALUES (?, ?)', (EMPLOYERS_DB, key))
    db.commit()


def sync_notion(db, tracker, limit=200):
    """Write every checked employer this Employers & Sources database has no row for yet: the ones checked while the app had no Notion
    (trying it, before connecting), a write that failed, or a workspace connected later. Before 6 Oct 2026 they stayed only on this
    computer: three Find new employers runs (45 employers, Breitling's feed among them) never reached the user's Notion. Safe to repeat:
    write_notion matches rows by company name. Returns (written, failed)."""
    if not tracker or not EMPLOYERS_DB:
        return 0, 0
    # A duplicate (the same feed as one already read, under another name) is stored as 'found' so it is not checked again, but it never got a
    # row of its own (run() skips it): a 'found' is written only when its feed is registered under its own name (7 Oct 2026, e2e employers).
    rows = db.execute(f"""SELECT key, name, origin, tier, ats, slug, careers, website, status, quality, stats_json FROM scout_candidates c
        WHERE checked_at IS NOT NULL AND status IN ({','.join('?' * len(FEED_STATUS))})
        AND (status != 'found' OR EXISTS (SELECT 1 FROM feed_sources f WHERE f.ats = c.ats AND f.slug = c.slug AND f.company = c.name))
        AND key NOT IN (SELECT key FROM notion_synced WHERE db_id = ?) ORDER BY checked_at LIMIT ?""",
                      (*FEED_STATUS, EMPLOYERS_DB, limit)).fetchall()
    written = failed = 0
    for key, name, origin, tier, system, slug, careers, website, status, score, stats in rows:
        candidate = {'key': key, 'name': name, 'origin': origin, 'tier': tier, 'careers': careers, 'website': website}
        outcome = {'status': status, 'ats': system, 'slug': slug, 'quality': score, 'stats': json.loads(stats) if stats else None}
        try:
            write_notion(tracker, candidate, outcome)
        except Exception as error:  # noqa: BLE001  one employer failing must not stop the others; tried again next time
            failed += 1
            print(f'Warning: Notion not updated for {name}: {type(error).__name__}: {error}')
            continue
        mark_synced(db, key)
        written += 1
    return written, failed


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


def run(db, batch=DEFAULT_BATCH, tracker=None, seeds=None, probe=ats.probe, harvest_sources=None, workers=6, static=None, budget=0):
    """Harvest, probe one batch, register what is useful. Returns (summary dict, list of outcomes).
    A board already crawled is a duplicate: the starter list (`static`, default config/sources.json), the feeds registered here and the Active Employers & Sources rows."""
    seeds = seeds or json.loads(SEEDS.read_text())
    if static is None:
        static = starter_list()
    # Each step says so as it starts: a run takes minutes, and the app's live log shows these lines ("Nothing to show yet" for four
    # minutes was the owner's find of 5 Oct 2026).
    from .ai import scout_ideas
    skip = skipped_origins(seeds, scout_ideas.technical(load_search_config()))
    print('Scout: reading the employer lists…' if not skip else
          'Scout: reading the employer lists (your roles are outside IT, so the tech company lists are left out)…')
    waiting = pending_count(db)
    if waiting > IDEAS_PAUSE and harvest_sources is None:
        added, ideas = 0, None
        print(f'Scout: {waiting} candidates still untried, so no new names this run (more than {IDEAS_PAUSE} wait); checking them first…')
    else:
        added = harvest(db, seeds, harvest_sources, skip)
        print(f'Scout: {added} new candidate(s) from the lists; asking the AI for ideas…')
        ideas = ai_ideas(db, harvest_sources)
        if ideas:
            added += harvest(db, seeds, [lambda: ideas['candidates']], skip)
    batch = batch_for(pending_count(db), batch)
    candidates, left = next_batch(db, batch, skip), 0
    # Employers some install (or the central scout) found with no readable job site lately are not probed again here; the next names take
    # their places, so a run probes its whole batch (7 Oct 2026: 52 of 92 were left out and the run checked 40).
    dead = set() if CENTRAL else employer_index.central_nofeed()
    for _ in range(10):
        skipped = [c for c in candidates if key_for(c['name']) in dead and c['status'] != 'manual']
        if not skipped:
            break
        later = (now() + timedelta(days=30)).isoformat(timespec='seconds')
        for c in skipped:
            db.execute("UPDATE scout_candidates SET status='none', checked_at=?, next_check=?, checked_with=? WHERE key=?",
                       (now().isoformat(timespec='seconds'), later, READERS, c['key']))
        db.commit()
        left += len(skipped)
        candidates = next_batch(db, batch, skip)   # those just left out now wait 30 days, so the next names come in
    if left:
        print(f'Scout: {left} employer(s) left for 30 days: other installs found no readable job site there lately; others took their places.')
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
        except Exception as error:  # noqa: BLE001  one employer's odd site must not end the run (7 Oct 2026: a TypeError at 90 of 91 lost them all)
            print(f"Warning: {candidate['name']} could not be checked: {type(error).__name__}: {str(error)[:160]}; counted as no job site we can "
                  'read, and checked again when the readers change')
            return {'status': 'none'}
        finally:
            with PROGRESS_LOCK:
                done.append(candidate['name'])
                progress_line(f"Scout: checked {len(done)} of {len(candidates)}: {candidate['name']}")

    note_site = []   # (candidate key, job site a web search found but nobody could read): saved as its careers address
    def check_one(candidate):
        if candidate['status'] == 'manual':
            return {'status': 'manual'}
        found = find_feed(candidate, probe, note=lambda system, slug, why: unread.append((system, why, candidate['name'])), search=search,
                          jobsch_lookup=lookup)
        if not found:
            site = candidate.get('found_site') or candidate.get('careers') or candidate.get('website') or ''
            if candidate.get('found_site'):   # where a person would land from "<company> jobs": the address to open, for everyone after
                note_site.append((candidate['key'], candidate['found_site']))
            why = careers.REFUSALS.get(re.sub(r'^https?://(www\.)?', '', site).split('/')[0].lower()) if site else None
            if why:   # its site refuses automated visitors: a person can still open it (src/sources/visits.py)
                from .sources import visits
                visits.refused(candidate['name'], site if '//' in site else f'https://{site}', why)
            return {'status': 'none'}
        system, slug, jobs = found
        if not jobs:
            return {'status': 'watch', 'ats': system, 'slug': slug}
        score, stats = quality(jobs)
        useful = stats['preferred'] >= 1 or (candidate['tier'] == 'Tier 1' and stats['relevant'] >= TIER1_MIN_RELEVANT)
        status = 'duplicate' if (system, slug) in active else ('found' if useful else 'low')
        return {'status': status, 'ats': system, 'slug': slug, 'quality': score, 'stats': stats}

    stamp = now()
    shared = {'found': [], 'none': [], 'failed': 0}   # the instant shares of this run, said once at the end (7 Oct 2026)
    def save(candidate, outcome):
        """One checked employer, written at once: a run stopped halfway keeps what it checked (7 Oct 2026)."""
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
        if not CENTRAL and outcome['status'] in ('found', 'none'):   # to the central list right away (opt-in): closing the app loses nothing
            from . import contribute
            if outcome['status'] == 'found':
                ok = contribute.share_now(feed={'ats': outcome['ats'], 'slug': outcome['slug'], 'company': candidate['name'][:120],
                                           'how': contribute.how_of(candidate.get('origin')), 'site': candidate.get('careers') if str(candidate.get('careers') or '').startswith('https://') else None,
                                           'jobs': int((outcome.get('stats') or {}).get('jobs') or 0)})
            else:
                site = re.sub(r'^https?://(www\.)?', '', candidate.get('website') or '').split('/')[0].lower() or None
                ok = contribute.share_now(dead={'company': candidate['name'][:120], 'host': site})
            if ok:
                shared[outcome['status']].append(candidate['name'])
            elif contribute.enabled():
                shared['failed'] += 1
        if tracker and outcome['status'] != 'duplicate':
            try:
                write_notion(tracker, candidate, outcome)
                mark_synced(db, candidate['key'])
            except Exception as error:
                print(f"Warning: Notion not updated for {candidate['name']}: {type(error).__name__}: {error}")


    # Each employer is saved as soon as it is checked, here on this thread (the database is not shared across threads); a stop (SIGTERM)
    # leaves at once instead of waiting for the whole batch (src/notion/cron_runs.py _on_terminate).
    # A time budget (the app: SCOUT_BUDGET_S): no new check starts after it, the ones running finish, the rest wait for the next run (owner,
    # 7 Oct 2026: "runs for too long"; 91 checks at 20-45 s each took over half an hour). Each one is saved as it ends, so nothing is lost.
    outcomes = [None] * len(candidates)
    deadline = time.monotonic() + budget if budget else None
    pool = ThreadPoolExecutor(max_workers=workers)
    try:
        todo, futures = iter(enumerate(candidates)), {}
        def more():
            while len(futures) < workers and (deadline is None or time.monotonic() < deadline):
                nxt = next(todo, None)
                if nxt is None:
                    return
                futures[pool.submit(check, nxt[1])] = nxt[0]
        more()
        while futures:
            future = next(as_completed(futures))
            i = futures.pop(future)
            outcomes[i] = future.result()
            save(candidates[i], outcomes[i])
            more()
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    if None in outcomes:
        done_now = sum(1 for o in outcomes if o is not None)
        span = f'{budget // 60} min' if budget >= 60 else f'{budget} s'
        print(f'Scout: its {span} are up: {done_now} of {len(candidates)} checked (the ones under way finished); the other {len(candidates) - done_now} wait for the next run.')
        kept = [(c, o) for c, o in zip(candidates, outcomes) if o is not None]
        candidates, outcomes = [c for c, _ in kept], [o for _, o in kept]
    for key, url in note_site:
        db.execute("UPDATE scout_candidates SET careers = ? WHERE key = ? AND COALESCE(careers, '') = ''", (url, key))
    record_unread(db, unread)

    if shared['found'] or shared['none'] or shared['failed']:
        names = lambda items: ', '.join(items[:10]) + (f' and {len(items) - 10} more' if len(items) > 10 else '')  # noqa: E731
        print(f"Pool: shared {len(shared['found'])} new employers ({names(shared['found']) or 'none'}) and {len(shared['none'])} dead ends "
              f"({names(shared['none']) or 'none'}) as they were found" + (f"; {shared['failed']} not sent, the end-of-run share carries them" if shared['failed'] else ''))
    where, params = skipping(skip)
    queued = db.execute(f"SELECT COUNT(*) FROM scout_candidates WHERE status = 'pending' {where}", params).fetchone()[0]
    total_feeds = db.execute('SELECT COUNT(*) FROM feed_sources WHERE active = 1').fetchone()[0]
    # Each run checks names it never checked before (pending), and only re-checks one whose wait is over (RECHECK_DAYS): said in the card, so
    # "15 checked" is never read as the same list again (6 Oct 2026).
    first = sum(1 for c in candidates if not c.get('checked_at'))
    return {'checked': len(candidates), 'first_time': first, 'left': left, 'harvested': added, 'queued': queued, 'total_feeds': total_feeds,
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
    left = summary.get('left') or 0
    if left:   # not checked here: other installs found no job site there lately (7 Oct 2026: 52 of 92 went unsaid)
        detail.append(f"{left} set aside for 30 days (other installs found no job site we can read there)")
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
    # Checked again only once every new name was tried (next_batch): said, so it is not read as effort spent instead of new names (7 Oct 2026).
    return tgcard.card('New employer sources', tgcard.dot(f"{summary['checked']} checked", f"{first} new to the search" if first is not None else '',
                                                         f"{again} checked again (no new names left)" if again else '',
                                                         f"{left} set aside" if left else '', f"{len(found)} new source{plural}"), blocks,
                       emoji='🔎', footer='Source quality measures the source, not your job fit.')


def ai_cost_line(what, usd, api_calls, plan_calls, calls):
    """What a run's AI cost, in words: dollars only for calls on the API key; calls through Claude Code are on the user's Claude plan
    (6 Oct 2026: "$0.000 in 21 call(s)" read as broken to a Claude Code user)."""
    if plan_calls and not api_calls:
        return f'AI of this {what}: {plan_calls} call(s) on your Claude plan (Claude Code: no cost per call)'
    if plan_calls:
        return f'AI cost of this {what}: ${usd:.3f} for {api_calls} call(s) on your API key, plus {plan_calls} on your Claude plan'
    return f'AI cost of this {what}: ${usd:.3f} in {calls} call(s)'


def report_ai_cost(side):
    """Print what this run's AI calls cost, and write {usd, calls} to JOB_PILOTTO_AI_COST_FILE when set (the central scout's workflow
    reports it to the owner's /ai-cost page). Always written when asked, even $0: a job that spent nothing must still show up."""
    usd, calls = float(side.get('usd') or 0), int(side.get('done') or 0)
    print(ai_cost_line('scout run', usd, int(side.get('api_calls') or 0), int(side.get('cli_calls') or 0), calls))
    target = os.getenv('JOB_PILOTTO_AI_COST_FILE')
    if target:
        Path(target).write_text(json.dumps({'usd': round(usd, 6), 'calls': calls}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=JOBS_DB)
    parser.add_argument('--batch', type=int, default=DEFAULT_BATCH, help='candidates probed per run')
    parser.add_argument('--budget', type=int, default=0, help='seconds: no new check starts after this; the rest wait for the next run (0 = none)')
    parser.add_argument('--send', action='store_true', help='send the summary to Telegram')
    parser.add_argument('--log-run', action='store_true', help='log this run to Notion ⏱️ Search runs (the desktop app does)')
    parser.add_argument('--publish-index', action='store_true',
                        help='the central scout: after the run, verify every feed and upload the employer index '
                             '(needs INDEX_PUBLISH_KEY; URL: JOB_PILOTTO_INDEX_URL or the default)')
    parser.add_argument('--sync-notion', action='store_true',
                        help='write the employers already checked on this computer that Employers & Sources lacks (the app runs it when '
                             'Notion is connected), then stop')
    parser.add_argument('--export-sources', action='store_true',
                        help='write config/sources.json: the shared starter list of verified public feeds '
                             '(sources.json + Active Employers & Sources rows); needs NOTION_TOKEN')
    args = parser.parse_args()
    if args.sync_notion:
        tracker = notion.Tracker.from_env()
        if not tracker or not EMPLOYERS_DB:
            print('Employers: Notion is not connected; nothing to write.')
            return 0
        with store.connect(args.db) as db:
            db.executescript(TABLES)
            written, failed = sync_notion(db, tracker)
        print(f'Employers: {written} written to Notion')   # each one not written said so in its own Warning line
        return 1 if failed and not written else 0
    global CENTRAL
    CENTRAL = bool(args.publish_index)   # the central scout: its full lists, published to every install
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
        summary, results = run(db, args.batch, tracker, budget=args.budget)
        if tracker:   # employers checked earlier without Notion, or whose write failed, catch up now
            written, failed = sync_notion(db, tracker)
            if written or failed:
                print(f'Employers: {written} checked earlier written to Notion')
        if not CENTRAL:   # what this run found goes to the central list right away (opt-in; src/contribute.py), not with the next jobs check
            try:
                from . import contribute
                contribute.maybe_send(active_sources(db, tracker, starter_list()), {'sources': []}, tracker, db=db)
            except Exception as error:  # noqa: BLE001 — the pool never affects a run
                print(f'Warning: pool contribution skipped: {type(error).__name__}: {error}')
        if args.publish_index:
            key = os.getenv('INDEX_PUBLISH_KEY')
            if not key:
                raise SystemExit('--publish-index needs INDEX_PUBLISH_KEY')
            index_url = os.getenv('JOB_PILOTTO_INDEX_URL') or employer_index.URL
            contributions, shared_dead = fetch_contributions(index_url, key, with_nofeed=True)
            swiss_titles = []
            feeds_out, failed = build_index(db, json.loads((CONFIG / 'sources.json').read_text()), contributions=contributions,
                                            boards=json.loads(SEEDS.read_text()).get('boards', []), swiss_titles=swiss_titles)
            stats = central_stats(db, feeds_out, market_coverage(swiss_titles))
            boards = board_stats(fetch_boards(index_url, key))
            count = publish_index(feeds_out, index_url, key, stats=stats, nofeed=dead_ends(db, shared_dead), boards=boards)
            print(publish_summary(feeds_out, contributions, boards))
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
