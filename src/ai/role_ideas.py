"""Roles suggested for you (owner, 7 Oct 2026: "suggest potential roles"): the "too narrow" box's chips were words common in the market's
titles ("social media", "graphic designer"), which did not fit the owner. Here Claude reads the Profile and the search's role words and
proposes up to MAX_IDEAS neighbouring roles this person could do, each with the word to search for (in the language jobs in their places use);
each is counted in the titles of their places that the role words miss (src/coverage.py missed_titles). At most once a day, kept in
data/role_ideas.json; ideas the person set aside are never proposed again.

What Claude sees: the Profile text, the role words, places and words ruled out; never the jobs or employers.
"""
import hashlib
import json
from datetime import datetime, timezone

from ..paths import DATA, keyword_regex

MODEL = 'claude-sonnet-5-5'
MAX_IDEAS = 8
STORE = DATA / 'role_ideas.json'
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['ideas'],
          'properties': {'ideas': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['role', 'word', 'why'],
                                                              'properties': {'role': {'type': 'string', 'description': 'The role, a few words'},
                                                                             'word': {'type': 'string', 'description': 'The word or short phrase a job title for it contains, in the language jobs in their places use'},
                                                                             'why': {'type': 'string', 'description': 'One short reason from their profile'}}}}}}
SYSTEM = """You suggest roles to a job seeker that they could do but do not search for yet. You get their profile (CV and preferences), the \
role words they search with, their places, the words they rule out, and roles they already set aside. Suggest up to 8 neighbouring roles \
their experience fits at a similar level: the same skills used in another job (a photographer: studio or photo lab assistant, product \
photographer, image retoucher; a shop seller: cashier, visual merchandiser, order picker). For each, give the word or short phrase a job \
title for it would contain, in the language most jobs in their places are written in (French in Geneva, German in Zurich), and one short \
reason from their profile. Never a role they already search for, rule out, or set aside; nothing far above or below their level."""


def _key(search):
    words = {'roles': sorted(str(w) for w in search.get('role_keywords') or [])}
    return hashlib.sha1(json.dumps(words, ensure_ascii=False).encode()).hexdigest()[:12]


def _load():
    try:
        return json.loads(STORE.read_text())
    except (OSError, ValueError):
        return {}


def count(word, titles):
    """Titles (of the places, missed by the role words) that contain this word."""
    try:
        pattern = keyword_regex([word])
    except Exception:  # noqa: BLE001 — a word that is no pattern counts nothing
        return 0
    return sum(1 for title in titles if pattern.search(title))


def ideas(profile, search, titles, set_aside=(), client=None, today=None):
    """[{role, word, why, count}] for this search, from today's answer when there is one; asked of Claude at most once a day."""
    today = today or datetime.now(timezone.utc).date().isoformat()
    key, data = _key(search), _load()
    aside = {str(w).lower() for w in set_aside}
    kept = data.get(key) or {}
    roles = sorted({str(w).lower() for w in search.get('role_keywords') or []})
    # Roles only added since today's answer (one of these ideas taken, or typed on Strategy): today's ideas still hold, minus the added ones.
    # 7 Oct 2026: every "Add role" changed the key and asked Claude again, 10 paid calls in an afternoon and a new list each time.
    earlier = next((entry for entry in data.values() if entry.get('day') == today and entry.get('roles') is not None
                    and set(entry['roles']) <= set(roles)), None)
    if kept.get('day') != today and earlier:
        kept = earlier
    if kept.get('day') != today:
        if not (profile or '').strip():
            return []
        from . import engine, cost
        from ..notion.search_settings import terms
        places = search.get('locations') or {}
        ask = {'profile': profile[:6000], 'role_words': terms(search.get('role_keywords'))[:30],
               'places': terms((places.get('top_tier') or []) + (places.get('country_wide') or []))[:10],
               'ruled_out': terms(search.get('title_exclude_keywords'))[:20], 'set_aside': sorted(aside)[:40]}
        client = client or engine.client(action='role_ideas')
        response = client.messages.create(model=MODEL, max_tokens=1200, system=[{'type': 'text', 'text': SYSTEM}],
                                          messages=[{'role': 'user', 'content': 'The job seeker (JSON):\n' + json.dumps(ask, ensure_ascii=False)}],
                                          output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        answer = json.loads(next(b.text for b in response.content if b.type == 'text'))
        kept = {'day': today, 'roles': roles, 'ideas': [{k: str(i.get(k) or '')[:120] for k in ('role', 'word', 'why')} for i in answer.get('ideas') or []][:MAX_IDEAS]}
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps({key: kept}, ensure_ascii=False))   # this search's ideas only
        print(f"Roles: Claude suggested {len(kept['ideas'])} role(s) for this search")
    have = {str(w).lower() for w in search.get('role_keywords') or []}
    out = [{**i, 'count': count(i['word'], titles)} for i in kept.get('ideas') or []
           if i.get('word') and i['word'].lower() not in have and i['word'].lower() not in aside]
    return sorted(out, key=lambda i: -i['count'])
