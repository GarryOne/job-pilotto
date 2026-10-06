"""Opt-in: tell the central pool which employer career pages this install uses, with coarse tags (docs/superpowers/specs/2026-09-30-pool-contributions.md).

Only public facts go up (ATS, board slug, company) plus role families and regions from fixed lists. Nothing about jobs,
applications, the CV or the person. Sent only when JOB_PILOTTO_SHARE_EMPLOYERS=1 (the app sets it: on by default for new installs, off if the user switched it off);
`python -m src contribute --show` prints exactly what would be sent, on or off.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import re
import urllib.request

from .paths import DATA, load_search_config
from .sources import ats

URL = 'https://www.jobpilotto.workers.dev/api/contribute'
STAMP = DATA / 'contribution_sent.json'
EVERY = timedelta(minutes=10)   # shared after every jobs check and every 'Find new employers' (owner, 6 Oct 2026; was once a day)
MAX_FEEDS = 500

# Fixed lists: the only tags that ever leave the machine.
ROLES = {
    'software': r'software|developer|programmer|backend|back-end|frontend|front-end|full.?stack|web\b',
    'sre_devops': r'\bsre\b|site reliability|devops|platform|infrastructure|cloud|sysadmin|systems? (admin|engineer)|network',
    'data': r'\bdata\b|analytics|business intelligence|\bbi\b|machine learning|\bml\b|\bai\b|scientist',
    'security': r'security|infosec|appsec',
    'mobile': r'mobile|\bios\b|android',
    'qa': r'\bqa\b|quality assurance|test automation|\bsdet\b',
    'management': r'engineering manager|head of|\bcto\b|tech(nical)? lead|director',
}
# And the kinds of role of every other trade (src/role_kinds.py KINDS), sent by name: the site accepts this same list (site/src/pool.js ROLES).
TRADE_ROLES = ['sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades']
REGIONS = {
    'europe': r'europe|\beu\b|emea|switzerland|z[uü]rich|geneva|basel|germany|berlin|munich|hamburg|frankfurt|netherlands|amsterdam|'
              r'rotterdam|united kingdom|\buk\b|england|london|manchester|edinburgh|ireland|dublin|france|paris|lyon|spain|madrid|'
              r'barcelona|portugal|lisbon|porto|italy|milan|rome|sweden|stockholm|denmark|copenhagen|norway|oslo|finland|helsinki|'
              r'poland|warsaw|krak[oó]w|czech|prague|austria|vienna|belgium|brussels|luxembourg|estonia|tallinn|latvia|riga|lithuania|'
              r'vilnius|romania|bucharest|hungary|budapest|greece|athens|bulgaria|sofia|croatia|zagreb',
    'north_america': r'united states|\busa?\b|new york|san francisco|seattle|austin|boston|chicago|los angeles|canada|toronto|vancouver|'
                     r'montreal|north america',
    'latin_america': r'latin america|\blatam\b|brazil|s[aã]o paulo|argentina|buenos aires|mexico|colombia|bogot[aá]|chile|santiago|peru',
    'asia_pacific': r'\bapac\b|asia|india|bangalore|bengaluru|mumbai|hyderabad|pune|delhi|singapore|japan|tokyo|korea|seoul|china|'
                    r'hong kong|taiwan|australia|sydney|melbourne|new zealand|auckland|indonesia|jakarta|philippines|thailand|vietnam|malaysia',
    'middle_east_africa': r'middle east|\bmena\b|dubai|abu dhabi|united arab emirates|\buae\b|saudi|riyadh|qatar|doha|israel|tel aviv|'
                          r'turkey|istanbul|egypt|cairo|africa|nigeria|lagos|kenya|nairobi|south africa|cape town|morocco',
}
_ROLES = {name: re.compile(rx, re.I) for name, rx in ROLES.items()}
_REGIONS = {name: re.compile(rx, re.I) for name, rx in REGIONS.items()}


def _plain(fragment):
    """A search.json regex fragment as plain words ('\\bberlin\\b' -> 'berlin')."""
    return re.sub(r'\\b|\\|[()?]|\.\*', ' ', fragment).strip()


REMOTE = re.compile(r'remote|anywhere|worldwide|home.?office|t[ée]l[ée]travail', re.I)


def regions_of(places):
    """The fixed-list regions a feed hires in, from its places ('Zurich, Switzerland' -> europe; 'Remote - EMEA' -> europe, remote)."""
    found = {name for name, rx in _REGIONS.items() if any(rx.search(place or '') for place in places)}
    if any(REMOTE.search(place or '') for place in places):
        found.add('remote')
    return sorted(found)


def tags(search=None):
    """(roles, regions) of this user's own search settings, as fixed-list names. No free text ever."""
    search = search or load_search_config()
    roles = {name for name, rx in _ROLES.items() if any(rx.search(_plain(k)) for k in search.get('role_keywords', []))}
    # The other trades by the role kinds (src/role_kinds.py), so a shop or warehouse search is not just 'other' (6 Oct 2026). Fixed names.
    from .role_kinds import of_search
    roles |= (of_search(search) or set()) - {'software', 'other'}
    places = [_plain(p) for group in ('top_tier', 'country_wide', 'abroad') for p in search.get('locations', {}).get(group, [])]
    regions = {name for name, rx in _REGIONS.items() if any(rx.search(p) for p in places)}
    return sorted(roles) or ['other'], sorted(regions)


# How an install found a feed, from the scout's candidate origin: fixed words only (the site accepts this same list: site/src/pool.js HOW).
HOW = (('AI idea', 'ai_idea'), ('AI list', 'ai_list'), ('jobs.ch employer', 'jobs_ch'), ('Wikidata', 'wikidata'), ('Tier 1 seed', 'seed'),
       ('Seed list', 'seed'), ('Hacker News', 'hn'), ('hiring-without-whiteboards', 'whiteboards'), ('SwissDevJobs', 'swissdevjobs'))


def how_of(origin):
    return next((word for prefix, word in HOW if str(origin or '').startswith(prefix)), 'other')


def found_here(db):
    """{(ats, slug): {'how', 'site'}} of the feeds this install's own scout verified (src/scout.py feed_sources), with how it found them."""
    if db is None:
        return {}
    try:
        rows = db.execute("""SELECT f.ats, f.slug, c.origin, c.careers FROM feed_sources f
            LEFT JOIN scout_candidates c ON c.ats = f.ats AND c.slug = f.slug WHERE f.active = 1""").fetchall()
    except Exception:  # noqa: BLE001 — no scout tables yet: nothing found here
        return {}
    site = lambda url: url if isinstance(url, str) and url.startswith('https://') and len(url) <= 200 else None
    return {(row[0], row[1]): {'how': how_of(row[2]), 'site': site(row[3])} for row in rows}


def payload(feed_list, report, tracker=None, install=None, search=None, db=None):
    """What would be sent (v2): every feed this install's scout verified, the feeds that gave this user a job (`matched`) and the ones they
    added themselves (`own`), each with how it was found, jobs listed, jobs that matched in their places, its job site and a failed read
    (6 Oct 2026: only matched or own feeds went, without numbers, so most finds stayed on the Mac)."""
    from . import scout
    matched = {s['company'] for s in report.get('sources', []) if s.get('ok') and s.get('matches')}
    read = {s['company']: s for s in report.get('sources', [])}
    found = found_here(db)
    own = set()
    if tracker:
        try:
            own = {(system, slug) for _, system, slug in scout.notion_feeds(tracker)}
        except Exception as error:  # noqa: BLE001 — Notion trouble just means no "own" flags today
            print(f'Warning: own employers not read for the pool: {type(error).__name__}')
    feeds = []
    for source in feed_list:
        system, slug = source.get('ats', 'greenhouse'), source.get('slug') or source.get('board')
        if system not in ats.FETCHERS or not slug:
            continue
        is_own, is_matched, here = (system, slug) in own, source['company'] in matched, found.get((system, slug))
        if is_own or is_matched or here:
            seen = read.get(source['company']) or {}
            feeds.append({'ats': system, 'slug': slug, 'company': source['company'][:120], 'matched': is_matched, 'own': is_own,
                          'how': (here or {}).get('how') or ('own' if is_own else 'index'), 'site': (here or {}).get('site'),
                          **({'jobs': int(seen.get('total') or 0), 'hits': int(seen.get('matches') or 0)} if seen.get('ok') else {}),
                          'failed': bool(seen) and not seen.get('ok')})
    roles, regions = tags(search)
    return {'v': 2, 'install': install or os.getenv('JOB_PILOTTO_INSTALL_ID', ''), 'roles': roles, 'regions': regions,
            'feeds': feeds[:MAX_FEEDS]}


def enabled(env=None):
    from .features import disabled
    env = os.environ if env is None else env
    return env.get('JOB_PILOTTO_SHARE_EMPLOYERS') == '1' and bool(env.get('JOB_PILOTTO_INSTALL_ID')) and not disabled('contribute', env)


def due(now=None, stamp=None):
    stamp = stamp or STAMP
    now = now or datetime.now(timezone.utc)
    try:
        return now - datetime.fromisoformat(json.loads(stamp.read_text())['sent']) >= EVERY
    except (OSError, ValueError, KeyError):
        return True


def send(body, url=None, post=None, now=None, stamp=None):
    """POST the payload; True when accepted. Never raises: the pool is a favour, not part of the run."""
    stamp = stamp or STAMP
    url = url or os.getenv('JOB_PILOTTO_CONTRIBUTE_URL') or URL

    def default_post(request):
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'User-Agent': ats.USER_AGENT})
    try:
        status = (post or default_post)(request)
    except Exception as error:  # noqa: BLE001
        print(f'Warning: pool contribution not sent ({type(error).__name__}: {error})')
        return False
    if status != 200:
        print(f'Warning: pool contribution refused ({status})')
        return False
    stamp.parent.mkdir(parents=True, exist_ok=True)
    stamp.write_text(json.dumps({'sent': (now or datetime.now(timezone.utc)).isoformat(timespec='seconds'), 'feeds': len(body['feeds'])}))
    return True


def maybe_send(feed_list, report, tracker=None, **kwargs):
    """Called after a full crawl and after a scout run: does nothing unless the user opted in, and at most every EVERY."""
    if not enabled() or not due(kwargs.get('now'), kwargs.get('stamp')):
        return False
    body = payload(feed_list, report, tracker, search=kwargs.get('search'), db=kwargs.get('db'))
    if not body['feeds']:
        return False
    sent = send(body, url=kwargs.get('url'), post=kwargs.get('post'), now=kwargs.get('now'), stamp=kwargs.get('stamp'))
    if sent:
        print(f"Shared {len(body['feeds'])} employer feeds with the pool (roles {body['roles']}, regions {body['regions']})")
    return sent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--show', action='store_true', help='print exactly what would be sent (nothing is sent)')
    args = parser.parse_args()
    from . import scout, store
    from .notion import client as notion
    from .paths import CONFIG, JOBS_DB
    tracker = notion.Tracker.from_env()
    with store.connect(JOBS_DB) as db:
        feed_list = scout.active_sources(db, tracker, scout.starter_list())
        # Without a crawl in hand: the feeds the scout verified and the user's own are shown; matched ones and counts join after a crawl.
        body = payload(feed_list, {'sources': []}, tracker, db=db)
    body['install'] = (body['install'] or '')[:8] + '…' if body['install'] else '(your random install id)'
    print(json.dumps(body, indent=1, ensure_ascii=False))
    print('\nThis is a preview and nothing is sent by it. After each jobs check and each "Find new employers" (at most every 10 minutes, '
          'and only when this is switched on) every feed your scout verified, the ones that gave you a job and the ones you added are sent, '
          'with how each was found and how many jobs it listed and matched: public facts and counts, never your jobs, CV or search words.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
