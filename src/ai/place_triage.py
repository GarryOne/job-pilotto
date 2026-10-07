"""Which job locations are in the user's places, decided by AI (owner, 7 Oct 2026: "nothing hard-coded: around the globe there are thousands of
regions, places, cities; use AI to interpret locations"). Word patterns let "Wallisellen" (near Zürich) in as "Wallis" and "Klagenfurt" (Austria)
as "Genf". Now each distinct location a refresh meets is shown to Haiku with the places as the user wrote them (best places, anywhere in, abroad,
remote yes/no); it answers best place, in their places, or out. Each answer is kept per version of the places (data/place_triage.json), so a
location is asked about once; a change of places asks again.

What Haiku sees: location strings from job postings and the user's place words, nothing else (no CV, no profile, no title, no employer). Off
without AI or with JOB_PILOTTO_DISABLE=place_triage, and for a location not decided yet: the place words as patterns, as before (sources/feeds.py).
"""
import hashlib
import json
import threading
import time

from ..paths import DATA

MODEL = 'claude-haiku-4-5'
BATCH = 60   # short strings: ~60 a call
STORE = DATA / 'place_triage.json'
LOCK = threading.Lock()
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['best', 'inside', 'visa'],
          'properties': {'best': {'type': 'array', 'items': {'type': 'integer'}, 'description': 'Numbers of locations in one of the best places'},
                         'inside': {'type': 'array', 'items': {'type': 'integer'},
                                    'description': 'Numbers of the other locations inside the places they accept'},
                         'visa': {'type': 'array', 'items': {'type': 'integer'},
                                  'description': 'Numbers of the best or inside locations where their work rights do not let them work without a visa'}}}
SYSTEM = """You decide where job postings are, for one job seeker. You get the places they accept, in their own words (their best places, \
places where anywhere is fine, cities abroad, whether remote jobs count), and a numbered list of job locations as postings write them, in any \
language or format ("1211 Genf, Genf, CH", "Biel/Bienne", "Klagenfurt, AT, 9020", "Remote - EMEA", "Fnac Lausanne (Manor) (1)"). Use what \
you know of geography: a town belongs to its region and country; a region word ("Romandie", "Bay Area") stands for the towns in it; a suburb \
of a best city counts as near it only if it is really part of that city's area. Answer with the numbers of the locations in a best place \
("best") and of the other locations inside the places they accept ("inside"). Leave out: places outside them, a location naming only a \
country or a large area that is wider than their places ("Switzerland" for someone who wants only Romandie), and remote jobs unless they \
accept remote work and the posting does not limit it to a region outside their places. When a location is unclear, leave it out. Then, of \
the best and inside ones, answer in "visa" the numbers where their work rights (as they wrote them: a permit, a citizenship, "EU") do not \
let them work without a visa or sponsorship; when they gave no work rights, leave "visa" empty."""


def places_words(search, preferences=None):
    """The places as the user wrote them (readable words, not patterns)."""
    from ..notion.search_settings import terms
    places = search.get('locations') or {}
    remote = [str(v).strip().lower() for v in search.get('remote_jobs') or []]
    return {'best_places': terms(places.get('top_tier'))[:20], 'anywhere_in': terms(places.get('country_wide'))[:20],
            'cities_abroad': terms(places.get('abroad'))[:20], 'remote_jobs': 'no' if 'no' in remote else 'yes',
            'remote_limited_to_regions_they_cannot_work_from': terms(search.get('remote_excluded_regions'))[:20],
            'work_rights': [str(w) for w in (preferences or {}).get('work_rights') or []][:10]}


def _preferences():
    from ..paths import CONFIG
    try:
        return json.loads((CONFIG / 'preferences.json').read_text())
    except (OSError, ValueError):
        return {}


def _key(search):
    return hashlib.sha1(json.dumps(places_words(search, _preferences()), ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]


def norm(location):
    return ' '.join(str(location or '').lower().split())[:120]


def _load():
    try:
        return json.loads(STORE.read_text())
    except (OSError, ValueError):
        return {}


def known(search):
    """{location: 'best' | 'in' | 'out'} decided for these places so far."""
    return _load().get(_key(search)) or {}


def decide(locations, search, client=None):
    """Ask about the locations not decided yet for these places (a batch this refresh can finish), keep the answers; returns all known."""
    from . import cost, engine
    from .. import time_budget as budget
    key, decided = _key(search), dict(known(search))
    ask = list(dict.fromkeys(n for n in (norm(loc) for loc in locations) if n and n not in decided))
    ask = ask[:budget.in_calls('place_rounds', len(ask), BATCH, engine.PARALLEL)]
    if not ask:
        return decided
    client = client or engine.client(action='place_triage')
    words = places_words(search, _preferences())
    batches = [ask[start:start + BATCH] for start in range(0, len(ask), BATCH)]
    print(f'Places: asking Claude where {len(ask)} job location(s) are, in {len(batches)} batch(es) of up to {BATCH}', flush=True)
    from concurrent.futures import ThreadPoolExecutor
    from ..progress import Ticker
    ticker, lock, sorted_ = Ticker('Placing job locations with AI', len(ask), every=0), threading.Lock(), [0]

    def one(batch):
        if budget.over('place_rounds'):
            return
        listed = '\n'.join(f'{n}. {location}' for n, location in enumerate(batch, 1))
        response = client.messages.create(model=MODEL, max_tokens=800, system=[{'type': 'text', 'text': SYSTEM}],
                                          messages=[{'role': 'user', 'content': f'Their places (JSON): {json.dumps(words, ensure_ascii=False)}\nThe job locations:\n{listed}'}],
                                          output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        answer = json.loads(next(b.text for b in response.content if b.type == 'text'))
        best = {int(n) for n in answer.get('best') or [] if str(n).isdigit()}
        inside = {int(n) for n in answer.get('inside') or [] if str(n).isdigit()}
        visa = {int(n) for n in answer.get('visa') or [] if str(n).isdigit()}
        with lock:
            for n, location in enumerate(batch, 1):
                place = 'best' if n in best else 'in' if n in inside else 'out'
                decided[location] = place + (':visa' if place != 'out' and n in visa else '')   # 'best', 'in', 'in:visa', 'out'
            sorted_[0] += len(batch)
            ticker.tick(sorted_[0])
    began = time.monotonic()
    with ThreadPoolExecutor(max_workers=max(1, min(len(batches), engine.PARALLEL))) as pool:
        list(pool.map(one, batches))
    budget.record('place_rounds', time.monotonic() - began, -(-sorted_[0] // (BATCH * max(1, engine.PARALLEL))))
    with LOCK:
        data = _load()
        data[key] = {**(data.get(key) or {}), **decided}
        for old in list(data)[:-3]:   # the last few versions of the places only
            data.pop(old)
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps(data, ensure_ascii=False))
    asked = [loc for loc in ask if loc in decided]
    print(f'Places: Claude placed {len(asked)} location(s); {sum(1 for loc in asked if decided[loc] != "out")} are in your places', flush=True)
    return decided
