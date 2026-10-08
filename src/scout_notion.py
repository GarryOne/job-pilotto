"""Source scout, Notion registry: the Notion "Employers & Sources" database. Which feeds are active (`active_sources`, `notion_feeds`),
the local sources.json export, and writing each checked employer's row (`write_notion`, `sync_notion`).
Tests: tests/test_scout_notion_sync.py, tests/test_scout.py.
"""

import json
import os
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from . import employer_index, scout_core
from .paths import CONFIG
from .sources import ats, careers
from .scout_core import TABLES, key_for, now
from .scout_probe import board_url


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
    for page in tracker.query_database(scout_core.EMPLOYERS_DB, {'property': 'Active', 'checkbox': {'equals': True}}):
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
    existing = tracker.query_database(scout_core.EMPLOYERS_DB, {'property': 'Company', 'title': {'equals': candidate['name']}})
    if existing:
        tracker.update_page(existing[0]['id'], props)
    else:
        tracker.create_page(scout_core.EMPLOYERS_DB, props)


def mark_synced(db, key):
    db.execute('INSERT OR IGNORE INTO notion_synced (db_id, key) VALUES (?, ?)', (scout_core.EMPLOYERS_DB, key))
    db.commit()


def sync_notion(db, tracker, limit=200):
    """Write every checked employer this Employers & Sources database has no row for yet: the ones checked while the app had no Notion
    (trying it, before connecting), a write that failed, or a workspace connected later. Before 6 Oct 2026 they stayed only on this
    computer: three Find new employers runs (45 employers, Breitling's feed among them) never reached the user's Notion. Safe to repeat:
    write_notion matches rows by company name. Returns (written, failed)."""
    if not tracker or not scout_core.EMPLOYERS_DB:
        return 0, 0
    # A duplicate (the same feed as one already read, under another name) is stored as 'found' so it is not checked again, but it never got a
    # row of its own (run() skips it): a 'found' is written only when its feed is registered under its own name (7 Oct 2026, e2e employers).
    rows = db.execute(f"""SELECT key, name, origin, tier, ats, slug, careers, website, status, quality, stats_json FROM scout_candidates c
        WHERE checked_at IS NOT NULL AND status IN ({','.join('?' * len(FEED_STATUS))})
        AND (status != 'found' OR EXISTS (SELECT 1 FROM feed_sources f WHERE f.ats = c.ats AND f.slug = c.slug AND f.company = c.name))
        AND key NOT IN (SELECT key FROM notion_synced WHERE db_id = ?) ORDER BY checked_at LIMIT ?""",
                      (*FEED_STATUS, scout_core.EMPLOYERS_DB, limit)).fetchall()
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
