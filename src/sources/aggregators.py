"""Job aggregators with public APIs: more jobs straight away, and every employer they name becomes a scout candidate (via the jobs table).

Free, no key: Arbeitnow (Europe, mostly Germany), Himalayas and Jobicy (remote). Free with a key: Adzuna (`ADZUNA_APP_ID` +
`ADZUNA_APP_KEY`, 16 countries incl. Switzerland) and Jooble (`JOOBLE_API_KEY`). Each one's terms are kept: the job's own address and the
source's name go with every job (Jobicy, Arbeitnow ask for that), each is asked at most every SPACING_HOURS, and only the roles and places of
this user's search are kept. Remotive is not used: its terms forbid passing its jobs to another product. job-room.ch (the Swiss public
employment service) is not used either until it offers a documented public API.
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from . import ats, feeds

SPACING_HOURS = 6
PAGES = 2
TIMEOUT = 30
TABLE = 'CREATE TABLE IF NOT EXISTS aggregator_runs (source TEXT PRIMARY KEY, at TEXT NOT NULL)'
# Search-place country words -> Adzuna's country codes (the countries it covers).
ADZUNA_COUNTRIES = {'ch': r'switzerland|schweiz|suisse|z[uü]rich|gen[eè]v|basel|bern|lausanne|zug', 'de': r'germany|deutschland|berlin|munich|m[uü]nchen|hamburg|frankfurt',
                    'gb': r'united kingdom|\buk\b|england|london|manchester|edinburgh', 'nl': r'netherlands|amsterdam|rotterdam|utrecht', 'fr': r'france|paris|lyon',
                    'at': r'austria|vienna|wien', 'es': r'spain|madrid|barcelona', 'it': r'italy|milan|rome', 'pl': r'poland|warsaw|krak', 'be': r'belgium|brussels'}


def _get(url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers={'User-Agent': ats.USER_AGENT, 'Accept': 'application/json', **(headers or {})})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read())


def _when(value):
    try:
        return datetime.fromtimestamp(int(value), timezone.utc).date().isoformat()
    except (TypeError, ValueError):
        return str(value or '')[:10]


def _job(source, id, title, company, location, url, posted='', description='', remote=False, salary=''):
    return {**ats._job(f'{source}:{id}', title, location, url, posted, ats.plain(description), remote, salary), 'company': (company or '').strip() or 'Unknown employer'}


def arbeitnow(get=_get):
    jobs = []
    for page in range(1, PAGES + 1):
        for j in get(f'https://www.arbeitnow.com/api/job-board-api?page={page}').get('data', []):
            jobs.append(_job('arbeitnow', j.get('slug'), j.get('title'), j.get('company_name'), j.get('location') or ('Remote' if j.get('remote') else ''),
                             j.get('url'), _when(j.get('created_at')), j.get('description'), bool(j.get('remote'))))
    return jobs


def himalayas(get=_get):
    jobs, cursor = [], ''
    for _ in range(PAGES):
        data = get('https://himalayas.app/jobs/api?limit=100' + (f'&cursor={urllib.parse.quote(cursor)}' if cursor else ''))
        for j in data.get('jobs', []):
            where = ', '.join(j.get('locationRestrictions') or []) or 'Anywhere'
            jobs.append(_job('himalayas', j.get('guid'), j.get('title'), j.get('companyName'), f'Remote ({where})', j.get('applicationLink') or j.get('guid'),
                             _when(j.get('pubDate')), j.get('description') or j.get('excerpt'), True))
        cursor = data.get('nextCursor') or ''
        if not cursor:
            break
    return jobs


def jobicy(get=_get, tags=('devops', 'sre', 'cloud', 'kubernetes', 'platform')):
    jobs = []
    for tag in tags:
        for j in get(f'https://jobicy.com/api/v2/remote-jobs?count=50&tag={urllib.parse.quote(tag)}').get('jobs', []):
            jobs.append(_job('jobicy', j.get('id'), j.get('jobTitle'), j.get('companyName'), f"Remote ({j.get('jobGeo') or 'Anywhere'})", j.get('url'),
                             str(j.get('pubDate') or '')[:10], j.get('jobDescription') or j.get('jobExcerpt'), True))
    return jobs


def _queries(search):
    from ..notion.search_settings import terms
    return (terms(search.get('jobs_board_search_queries')) or terms(search.get('role_keywords')))[:4]


def _countries(search):
    from ..notion.search_settings import terms
    places = ' '.join(terms([p for group in (search.get('locations') or {}).values() for p in group])).lower()
    return [code for code, rx in ADZUNA_COUNTRIES.items() if re.search(rx, places)][:4]


def adzuna(search, get=_get):
    app_id, app_key = os.getenv('ADZUNA_APP_ID'), os.getenv('ADZUNA_APP_KEY')
    jobs = []
    for country in _countries(search):
        for query in _queries(search):
            params = urllib.parse.urlencode({'app_id': app_id, 'app_key': app_key, 'what': query, 'results_per_page': 50, 'content-type': 'application/json'})
            for j in get(f'https://api.adzuna.com/v1/api/jobs/{country}/search/1?{params}').get('results', []):
                salary = f"{j.get('salary_min') or ''}–{j.get('salary_max') or ''}".strip('–') if j.get('salary_min') or j.get('salary_max') else ''
                jobs.append(_job('adzuna', j.get('id'), j.get('title'), (j.get('company') or {}).get('display_name'), (j.get('location') or {}).get('display_name'),
                                 j.get('redirect_url'), str(j.get('created') or '')[:10], j.get('description'), False, salary))
    return jobs


def jooble(search, get=_get):
    key = os.getenv('JOOBLE_API_KEY')
    from ..notion.search_settings import terms
    places = terms((search.get('locations') or {}).get('top_tier'))[:2] or ['']
    jobs = []
    for query in _queries(search):
        for place in places:
            body = json.dumps({'keywords': query, 'location': place}).encode()
            for j in get(f'https://jooble.org/api/{urllib.parse.quote(key)}', body, {'Content-Type': 'application/json'}).get('jobs', []):
                jobs.append(_job('jooble', j.get('id'), j.get('title'), j.get('company'), j.get('location'), j.get('link'), str(j.get('updated') or '')[:10],
                                 j.get('snippet'), 'remote' in str(j.get('type') or '').lower(), j.get('salary') or ''))
    return jobs


def sources(env=None):
    """[(name, reader)] of the aggregators this install may use now (free ones always; keyed ones when their keys are set)."""
    env = os.environ if env is None else env
    from ..features import disabled
    found = [] if disabled('aggregators', env) else [('Arbeitnow', lambda search: arbeitnow()), ('Himalayas', lambda search: himalayas()),
                                                      ('Jobicy', lambda search: jobicy())]
    if env.get('ADZUNA_APP_ID') and env.get('ADZUNA_APP_KEY') and not disabled('adzuna', env):
        found.append(('Adzuna', adzuna))
    if env.get('JOOBLE_API_KEY') and not disabled('jooble', env):
        found.append(('Jooble', jooble))
    return found


def scan(db, search, now=None, readers=None):
    """A feeds.scan-style report ({'jobs', 'sources'}) from the aggregators that are due; your roles and places only, source named on each job."""
    now = now or datetime.now(timezone.utc)
    db.execute(TABLE)
    report = {'jobs': [], 'sources': []}
    for name, read in (readers if readers is not None else sources()):
        last = db.execute('SELECT at FROM aggregator_runs WHERE source = ?', (name,)).fetchone()
        if last and datetime.fromisoformat(last[0]) > now - timedelta(hours=SPACING_HOURS):
            continue
        try:
            found = read(search)
            matched = []
            with db:
                for job in found:
                    if not (job.get('url') and feeds.wanted_title(job['title']) and feeds.wanted_location(job)):
                        continue
                    matched.append({**{k: job[k] for k in ('company', 'id', 'title', 'url', 'date_posted', 'description')},
                                    'location': job['location'] or 'Unspecified', 'work_mode': 'Remote (stated)' if job['remote'] else '',
                                    'salary_text': job['salary'], 'notes': f'Found on {name}', 'source': name, 'source_kind': 'job board',
                                    'status': feeds.record(db, name.lower(), job, now.isoformat(timespec='seconds'))})
                db.execute('INSERT OR REPLACE INTO aggregator_runs (source, at) VALUES (?, ?)', (name, now.isoformat(timespec='seconds')))
            report['jobs'].extend(matched)
            report['sources'].append({'company': name, 'ok': True, 'total': len(found), 'matches': len(matched)})
        except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError) as error:
            report['sources'].append({'company': name, 'ok': False, 'error': f'{type(error).__name__}: {error}'})
    return report
