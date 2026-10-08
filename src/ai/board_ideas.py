"""Job boards for the user's countries and kinds of role, proposed by Claude (spec docs/superpowers/specs/2026-10-08-job-board-discovery.md;
owner, 8 Oct 2026: "We should be able to discover new job boards"). A board is data, never code: a name, its host and a search address with
{role} (and {place} when the board takes one). One call per set of countries, roles and kinds, kept in data/found_boards.json ('ideas');
Claude sees the countries, place words and role words only, never the CV. Every answer is checked here before anything reads it: an https
address on the board's own host, the {role} placeholder, not a portal the visit list already offers (LinkedIn, Indeed, Glassdoor,
levels.fyi) and not one of the boards with their own reader (jobs.ch, SwissDevJobs, TechTree). Tests: tests/test_board_ideas.py."""
import hashlib
import json
import re
import urllib.parse

from .models import SMALL_MODEL

MODEL = SMALL_MODEL
MAX_BOARDS = 12
OWN_READERS = ('jobs.ch', 'swissdevjobs.ch', 'techtree.io')   # src/sources/boards.py BOARDS: read by their own code, never twice
PORTALS = ('linkedin.', 'indeed.', 'glassdoor.', 'levels.fyi')  # src/sources/visits_portals.py: offered as visits already
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['boards'], 'properties': {'boards': {'type': 'array', 'items': {
    'type': 'object', 'additionalProperties': False, 'required': ['name', 'search_url', 'countries', 'kinds'],
    'properties': {'name': {'type': 'string'},
                   'search_url': {'type': 'string', 'description': 'Its public search page, https, with {role} where the keywords go and {place} '
                                                                   'where the place goes (left out when the board takes no place)'},
                   'countries': {'type': 'array', 'items': {'type': 'string'}, 'description': 'English country names it serves'},
                   'kinds': {'type': 'array', 'items': {'type': 'string'}}}}}}}
SYSTEM = """You know the job boards people really use to find work in each country. You get a job seeker's countries, places and roles. \
List up to 12 job boards (not company career sites, not recruiters) where jobs for these roles in these places are posted: the country's \
general boards first, then boards for these kinds of role (a developer board for developers, a hospitality board for chefs). Leave out \
LinkedIn, Indeed, Glassdoor and levels.fyi. For each, its public search page as a template: https, the board's own address, {role} where \
the keywords go and {place} where the place goes (no {place} when the board has no place search). Only boards you are confident exist with \
that search address; fewer is better than a guess. kinds: from software, sales_b2b, sales_retail, logistics, hospitality, healthcare, \
creative_media, finance_admin, education, trades, any."""
KINDS = ('software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education',
         'trades', 'any')


def _host(url):
    try:
        return (urllib.parse.urlsplit(url).hostname or '').lower().removeprefix('www.')
    except ValueError:
        return ''


def valid(board):
    """The board in the shape the code reads, or None: https on its own host, {role} in it, nothing but the two placeholders."""
    if not isinstance(board, dict):
        return None
    url, name = str(board.get('search_url') or '').strip(), re.sub(r'\s+', ' ', str(board.get('name') or '')).strip()[:60]
    host = _host(url.replace('{role}', 'x').replace('{place}', 'x'))
    if not (name and url.startswith('https://') and len(url) <= 300 and '{role}' in url and host and '.' in host):
        return None
    if set(re.findall(r'\{(\w*)\}', url)) - {'role', 'place'} or any(p in host for p in PORTALS) or any(host.endswith(o) for o in OWN_READERS):
        return None
    countries = [re.sub(r'\s+', ' ', str(c)).strip()[:40] for c in board.get('countries') or [] if str(c).strip()][:10]
    kinds = [k for k in board.get('kinds') or [] if k in KINDS] or ['any']
    return {'name': name, 'host': host, 'search_url': url, 'countries': countries, 'kinds': kinds}


def _store():
    from ..paths import DATA
    return DATA / 'found_boards.json'


def load():
    try:
        return json.loads(_store().read_text())
    except (OSError, ValueError):
        return {}


def save(data):
    file = _store()
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(data, ensure_ascii=False, indent=1))


def ideas(search, client=None):
    """The boards Claude proposed for this search's countries, roles and kinds (validated), from the cache when it already answered for
    them; [] without AI or without countries."""
    from .. import places
    from ..notion.search_settings import terms
    from ..role_kinds import of_search
    countries = places.countries(search, limit=5)
    roles = terms((search or {}).get('role_keywords'))[:20]
    if not countries or not roles:
        return []
    kinds = sorted(of_search(search) or [])
    place_words = [w for w in places.words_of(search)][:10]
    key = hashlib.sha256(json.dumps([countries, sorted(roles), kinds], ensure_ascii=False).encode()).hexdigest()[:12]
    data = load()
    if key in (data.get('ideas') or {}):
        return data['ideas'][key]
    try:
        from . import cost, engine
        if client is None:
            if not engine.ready():
                return []
            client = engine.client(action='scout')
        response = client.messages.create(
            model=MODEL, max_tokens=4000, system=[{'type': 'text', 'text': SYSTEM}],
            messages=[{'role': 'user', 'content': json.dumps({'countries': countries, 'places': place_words, 'roles': roles, 'kinds': kinds},
                                                             ensure_ascii=False)}],
            output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        if response.stop_reason != 'end_turn':
            raise RuntimeError(f'stopped with {response.stop_reason}')
        answer = json.loads(next(block.text for block in response.content if block.type == 'text')).get('boards') or []
    except Exception as error:  # noqa: BLE001 — the fixed boards and the shared ones still run
        print(f'Job boards: none proposed this time ({type(error).__name__}); the known boards still run', flush=True)
        return []
    found = list({b['host']: b for b in (valid(item) for item in answer) if b}.values())[:MAX_BOARDS]
    data.setdefault('ideas', {})[key] = found
    save(data)
    print(f"Job boards proposed for {', '.join(countries)}: {', '.join(b['name'] for b in found) or 'none'}", flush=True)
    return found
