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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from html import escape, unescape
import json
import os
from pathlib import Path
import re
import urllib.parse
import urllib.request

from . import store, telegram
from .notion import client as notion, cron_runs
from .paths import JOBS_DB, CONFIG, keyword_regex, load_search_config
from .sources import ats, feeds

SEEDS = CONFIG / 'scout_seeds.json'
# Notion "Employers & Sources": one row per employer or job board (formerly Source Registry + Company Research).
EMPLOYERS_DB = os.getenv('NOTION_EMPLOYERS_DB', '')
HN_THREADS = 2          # Latest monthly "Who is hiring?" threads to read.
RECHECK_DAYS = {'low': 21, 'none': 90}
# Tier 1 feeds are crawled with this many SRE-type roles anywhere: their Zurich/London roles come and go.
TIER1_MIN_RELEVANT = 3

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
    """Companies from recent 'Ask HN: Who is hiring?' posts that mention our places and SRE-type roles.

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
            name = re.split(r'\s[|\-–(]\s?|\s\(', plain.strip(), 1)[0].strip()[:60]
            if not name or len(name) < 2 or len(name.split()) > 5:
                continue
            links = re.findall(r'href="([^"]+)"', text) + re.findall(r'https?://\S+', plain)
            found = next((ats.detect(link) for link in links if ats.detect(link)), None)
            yield dict(name=name, origin=f"Hacker News: {story['title'][-16:-1]}", priority=85 if found else 60,
                       ats=found[0] if found else None, slug=found[1] if found else None)


def whiteboards_candidates(get=_get_text):
    """Companies from the open list poteto/hiring-without-whiteboards located in our places."""
    readme = get('https://raw.githubusercontent.com/poteto/hiring-without-whiteboards/main/README.md')
    for line in readme.splitlines():
        match = re.match(r'- \[([^\]]+)\]\(([^)]+)\) \| ([^|]+)', line)
        if not match or not re.search(r'z[uü]rich|switzerland|berlin|london|dubai|remote', match.group(3), re.I):
            continue
        name, url = match.group(1).strip(), match.group(2).strip()
        found = ats.detect(url)
        yield dict(name=name, origin='hiring-without-whiteboards', priority=70 if found else 35,
                   ats=found[0] if found else None, slug=found[1] if found else None, careers=url)


def local_company_candidates(db):
    """Employers already seen on jobs.ch / TechTree, with their careers link when known."""
    for row in db.execute('SELECT name, careers_url FROM companies'):
        found = ats.detect(row['careers_url'] or '')
        yield dict(name=row['name'], origin='jobs.ch employer', priority=80 if found else 45,
                   ats=found[0] if found else None, slug=found[1] if found else None, careers=row['careers_url'])


def harvest(db, seeds, sources=None):
    """Add unseen candidates; returns how many were new. Failing sources are skipped."""
    db.executescript(TABLES)
    extra = [name for name in os.getenv('JOB_PILOTTO_EXCLUDED_COMPANIES', '').split(',') if name.strip()]
    excluded = {key_for(name.strip()) for name in seeds.get('excluded', []) + extra}
    known = {row['key'] for row in db.execute('SELECT key FROM scout_candidates')}
    sources = sources if sources is not None else [
        lambda: seed_candidates(seeds), hacker_news_candidates, whiteboards_candidates,
        lambda: local_company_candidates(db)]
    added = 0
    for source in sources:
        try:
            candidates = list(source())
        except Exception as error:
            print(f'Warning: candidate source skipped: {type(error).__name__}: {error}')
            continue
        for c in candidates:
            key = key_for(c['name'])
            if not key or key in excluded or key in known:
                continue
            known.add(key)
            db.execute("""INSERT INTO scout_candidates (key, name, origin, priority, tier, ats, slug, careers, status, added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (key, c['name'], c['origin'], c['priority'], c.get('tier', 'Standard'), c.get('ats'),
                        c.get('slug'), c.get('careers'), c.get('status', 'pending'), now().isoformat(timespec='seconds')))
            added += 1
    db.commit()
    return added


def next_batch(db, size):
    stamp = now().isoformat(timespec='seconds')
    return [dict(row) for row in db.execute("""SELECT * FROM scout_candidates
        WHERE status = 'pending' OR (status = 'manual' AND checked_at IS NULL)
           OR (status IN ('low', 'none') AND next_check <= ?)
        ORDER BY priority DESC, added_at ASC LIMIT ?""", (stamp, size))]


# ---------- probing and quality ----------

def find_feed(candidate, probe=ats.probe):
    """(ats, slug, jobs) for the candidate's public feed, or None."""
    if candidate.get('ats') and candidate.get('slug'):
        jobs = probe(candidate['ats'], candidate['slug'])
        if jobs:
            return candidate['ats'], candidate['slug'], jobs
    for slug in ats.slug_guesses(candidate['name']):
        for system in ats.GUESSABLE:
            jobs = probe(system, slug)
            if jobs:
                return system, slug, jobs
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
    # Up to 20 for SRE-type roles anywhere, 40 for roles in preferred places, 10 each for Switzerland,
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
        'netflix': 'https://explore.jobs.netflix.net/careers'}[system]


# ---------- registry used by the 4-hourly crawl ----------

def active_sources(db, tracker=None, static=()):
    """Feeds for feeds.scan: static sources.json + local feed_sources + active Notion Employers & Sources rows."""
    db.executescript(TABLES)
    sources = {(s.get('ats', 'greenhouse'), s.get('slug') or s['board']): dict(s) for s in static}
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


# ---------- Notion ----------

def _text(value):
    return {'rich_text': [{'text': {'content': (value or '')[:2000]}}]}


def research_links(name):
    query = urllib.parse.quote(name)
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return (f'https://www.glassdoor.com/Search/results.htm?keyword={query}',
            f'https://www.levels.fyi/companies/{slug}/salaries')


def write_notion(tracker, candidate, outcome):
    """One Employers & Sources row per candidate worth keeping (created or updated by company name)."""
    today = now().date().isoformat()
    glassdoor, levels = research_links(candidate['name'])
    status, system, slug, score, stats = (outcome.get(k) for k in ('status', 'ats', 'slug', 'quality', 'stats'))
    if status == 'none' and candidate['tier'] != 'Tier 1':
        return  # Keep the database focused: unfeedable standard companies are only tracked locally.
    feed_status = {'found': 'Feed found', 'low': 'Low relevance', 'manual': 'Manual watch', 'none': 'No public feed'}[status]
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
                      'Notes': _text(f"{stats['jobs']} postings; {stats['relevant']} SRE-type; {stats['preferred']} in "
                                     f"preferred places ({stats['swiss']} in Switzerland); stack overlap "
                                     f"{int(stats['stack_share'] * 100)}%"
                                     + ('; salaries published' if stats['salary_published'] else ''))})
    if status == 'found':
        props.update({'Integration': {'select': {'name': 'Working'}}, 'Added': {'date': {'start': today}}})
    existing = tracker.query_database(EMPLOYERS_DB, {'property': 'Company', 'title': {'equals': candidate['name']}})
    if existing:
        tracker.update_page(existing[0]['id'], props)
    else:
        tracker.create_page(EMPLOYERS_DB, props)


# ---------- one run ----------

def run(db, batch=15, tracker=None, seeds=None, probe=ats.probe, harvest_sources=None, workers=6):
    """Harvest, probe one batch, register what is useful. Returns (summary dict, list of outcomes)."""
    seeds = seeds or json.loads(SEEDS.read_text())
    added = harvest(db, seeds, harvest_sources)
    candidates = next_batch(db, batch)
    active = {(r['ats'], r['slug']) for r in db.execute('SELECT ats, slug FROM feed_sources')}

    def check(candidate):
        if candidate['status'] == 'manual':
            return {'status': 'manual'}
        found = find_feed(candidate, probe)
        if not found:
            return {'status': 'none'}
        system, slug, jobs = found
        score, stats = quality(jobs)
        useful = stats['preferred'] >= 1 or (candidate['tier'] == 'Tier 1' and stats['relevant'] >= TIER1_MIN_RELEVANT)
        status = 'duplicate' if (system, slug) in active else ('found' if useful else 'low')
        return {'status': status, 'ats': system, 'slug': slug, 'quality': score, 'stats': stats}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        outcomes = list(pool.map(check, candidates))

    stamp = now()
    for candidate, outcome in zip(candidates, outcomes):
        status = 'found' if outcome['status'] == 'duplicate' else outcome['status']
        next_check = (stamp + timedelta(days=RECHECK_DAYS[status])).isoformat(timespec='seconds') \
            if status in RECHECK_DAYS else None
        db.execute("""UPDATE scout_candidates SET status=?, ats=COALESCE(?, ats), slug=COALESCE(?, slug), quality=?,
            stats_json=?, checked_at=?, next_check=? WHERE key=?""",
                   (status, outcome.get('ats'), outcome.get('slug'), outcome.get('quality'),
                    json.dumps(outcome.get('stats')) if outcome.get('stats') else None,
                    stamp.isoformat(timespec='seconds'), next_check, candidate['key']))
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

    queued = db.execute("SELECT COUNT(*) FROM scout_candidates WHERE status = 'pending'").fetchone()[0]
    total_feeds = db.execute('SELECT COUNT(*) FROM feed_sources WHERE active = 1').fetchone()[0]
    return {'checked': len(candidates), 'harvested': added, 'queued': queued, 'total_feeds': total_feeds}, \
        list(zip(candidates, outcomes))


def telegram_summary(summary, results):
    found = sorted([(c, o) for c, o in results if o['status'] == 'found'], key=lambda x: -x[1]['quality'])
    counts = {s: sum(1 for _, o in results if o['status'] == s) for s in ('none', 'low', 'manual', 'duplicate')}
    lines = [f"🔎 <b>Source scout</b> · checked {summary['checked']} · 🆕 {len(found)} new source"
             + ('s' if len(found) != 1 else '')]
    for i, (c, o) in enumerate(found, 1):
        s = o['stats']
        tier = ' · ⭐ Tier 1' if c['tier'] == 'Tier 1' else ''
        where = f" ({s['swiss']} 🇨🇭)" if s['swiss'] else ''
        places = ', '.join(s['places'][:3])
        lines.append(f"\n{i}. <b>{escape(c['name'])}</b> · {o['ats'].capitalize()} · quality <b>{o['quality']}</b>{tier}\n"
                     f"   {s['relevant']} SRE-type roles · {s['preferred']} in your places{where}"
                     + (f"\n   <i>{escape(places)}</i>" if places else ''))
    if not found:
        lines.append('\nNo new useful feeds in this batch.')
    detail = [f"{counts['none']} without public feed", f"{counts['low']} low relevance"]
    if counts['manual']:
        detail.append(f"{counts['manual']} Tier 1 on manual watch")
    lines.append(f"\n<i>{' · '.join(detail)} · {summary['total_feeds']} feeds crawled · {summary['queued']} candidates "
                 f"queued{' · ' + str(summary['harvested']) + ' new candidates found' if summary['harvested'] else ''}</i>")
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=JOBS_DB)
    parser.add_argument('--batch', type=int, default=15, help='candidates probed per run')
    parser.add_argument('--send', action='store_true', help='send the summary to Telegram')
    parser.add_argument('--log-run', action='store_true', help='log this run to Notion ⏱️ Search runs (the desktop app does)')
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
    message = telegram_summary(summary, results)
    log['headline'] = cron_runs.plain(message).split('\n')[0]
    if args.send and not disabled('telegram'):
        print(message)
        telegram.send(message, *telegram.credentials())
    else:
        telegram.to_app(message)  # no Telegram: the desktop app shows the summary
    if logged:
        cron_runs.log_run(tracker, log)


if __name__ == '__main__':
    main()
