"""Source scout, harvest: where candidate employers come from (seed lists, Hacker News "Who is hiring?", hiring-without-whiteboards,
SwissDevJobs, jobs.ch employers seen, Wikidata) and `harvest`, which queues them in scout_candidates.
Tests: tests/test_scout.py, tests/test_seeds_private.py, tests/test_scout_ideas.py, tests/test_scout_e2e.py.
"""

import json
import os
import re
import urllib.parse
from datetime import datetime, timedelta
from html import unescape
from pathlib import Path
from . import scout_core
from .paths import CONFIG, keyword_regex, load_search_config, place_regex
from .sources import ats
from .scout_core import HN_THREADS, SEED_ORIGINS, TABLES, TECH_LIST_ORIGINS, _SEARCH, _get_json, _get_text, clean_name, key_for, now


LOCATION_WORDS = place_regex([*_SEARCH['locations']['top_tier'], *_SEARCH['locations']['country_wide'],
                                *_SEARCH['locations']['abroad'], 'remote'])
ROLE_WORDS = keyword_regex(_SEARCH['role_keywords'])


def starter_list():
    """This install's own starter feeds (config/sources.json), without the ones the app used to ship (they come from the central index)."""
    sources = json.loads((CONFIG / 'sources.json').read_text()) if (CONFIG / 'sources.json').exists() else []
    if scout_core.CENTRAL:
        return sources
    from .legacy_lists import SHIPPED_FEEDS
    return [s for s in sources if (s.get('ats', 'greenhouse'), s.get('slug') or s.get('board')) not in SHIPPED_FEEDS]


def seed_candidates(seeds):
    from .legacy_lists import SHIPPED_SEED_NAMES
    for c in _seed_candidates(seeds):
        if scout_core.CENTRAL or c['name'] not in SHIPPED_SEED_NAMES:   # an install's copy of the old shipped seeds: central now
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

# Any other country (8 Oct 2026: a search in Lisbon had only Swiss companies): the same query, the country found by its English name and
# an ISO code (so "Georgia" is the country). `staffed=False` also takes companies with no head count, which Wikidata lacks for many countries.
WIKIDATA_MIN_ROWS = 200


def wikidata_query(country='Switzerland', staffed=True):
    if country == 'Switzerland' and staffed:
        return WIKIDATA_QUERY
    where = (f'?country rdfs:label "{country}"@en; wdt:P297 []. ?c wdt:P17 ?country; wdt:P31/wdt:P279* wd:Q4830453; wdt:P856 ?site'
             + ('; wdt:P1128 ?staff. FILTER(?staff >= 30)' if staffed else '. OPTIONAL { ?c wdt:P1128 ?staff }'))
    return ('SELECT ?label ?site (MAX(?staff) AS ?employees) WHERE {\n  ' + where + '\n  ?c rdfs:label ?label. FILTER(LANG(?label) = "en") }'
            ' GROUP BY ?label ?site ORDER BY DESC(?employees) LIMIT 1500')


WIKIDATA_TIMEOUT_S = 150         # the query takes about 65 s (7 Oct 2026); at the old 30 s it failed in every run
WIKIDATA_MAX_AGE = timedelta(days=7)   # the list of Swiss companies barely changes in a week


def wikidata_rows(get=_get_json, cache=None, clock=None, query=WIKIDATA_QUERY):
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
    url = 'https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(query)
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


def search_countries():
    """The countries of the user's places (src/places.py), Switzerland when none is known yet: the product's first market."""
    try:
        from . import places
        return places.countries(load_search_config()) or ['Switzerland']
    except Exception as error:  # noqa: BLE001 — no places worked out (offline, no AI): as before
        print(f'Warning: the countries of your places are not known ({type(error).__name__}): looking in Switzerland')
        return ['Switzerland']


def wikidata_candidates(get=_get_json, cache=None, clock=None, countries=None):
    """Companies with a website and at least 30 employees in each country of your places, from Wikidata's open SPARQL service (bigger first);
    where Wikidata has fewer than WIKIDATA_MIN_ROWS of them, companies with no head count too. Any trade: the probe then keeps only those whose
    careers page lists jobs for your roles in your places. Each country's list is kept a week (Switzerland's in the file it always had)."""
    from .paths import DATA
    base = Path(cache) if cache else DATA / 'cache' / 'wikidata-companies.json'
    for country in countries or search_countries():
        slug = re.sub(r'[^a-z]+', '-', country.lower()).strip('-')
        file = base if country == 'Switzerland' else base.with_name(f'{base.stem}-{slug}{base.suffix}')
        try:
            rows = wikidata_rows(get, file, clock, wikidata_query(country))
            if len(rows) < WIKIDATA_MIN_ROWS:
                rows = rows + wikidata_rows(get, file.with_name(f'{file.stem}-all{file.suffix}'), clock, wikidata_query(country, staffed=False))
        except Exception as error:  # noqa: BLE001 — one country down leaves the others
            print(f'Warning: Wikidata companies in {country} skipped ({type(error).__name__}: {error})')
            continue
        origin = 'Wikidata: Swiss companies' if country == 'Switzerland' else f'Wikidata: companies in {country}'
        seen = set()
        for row in rows:
            name, site = row['label']['value'], row['site']['value']
            if site in seen:
                continue
            seen.add(site)
            staff = int(float(row.get('employees', {}).get('value', 0) or 0))
            yield dict(name=name, origin=origin, priority=60 if staff >= 200 else 50, website=site)


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
