"""Which job titles could fit this search (owner, 7 Oct 2026: "Only the location should be strict"): the title gate in front of the AI fit
score was the search's exact role words, so "Client Advisor" at Vacheron Constantin in Geneva and Fnac's "Collaborateur Magasin" were never
scored. Now a title in the user's places that the words miss is shown to Haiku with the search (role words, words ruled out); it answers which
could fit, and each decision is kept per search (data/title_triage.json), so a title is asked about once. The fit score then grades them.

What Haiku sees: job titles and the search's own words, nothing else (no CV, no profile, no employer). Off without AI, or with
JOB_PILOTTO_DISABLE=title_triage: the exact role words only, as before.
"""
import hashlib
import json
import threading

from ..paths import DATA

MODEL = 'claude-haiku-4-5'
BATCH = 100
MAX_NEW = 600       # titles asked about in one run at most (a first run on a big list is spread over the next ones)
STORE = DATA / 'title_triage.json'
LOCK = threading.Lock()
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['fit'],
          'properties': {'fit': {'type': 'array', 'items': {'type': 'integer'}, 'description': 'The numbers of the titles that could fit'}}}
SYSTEM = """You sort job titles for one job seeker. You get their search (the role words they wrote, and words that rule a title out) and a \
numbered list of job titles, in any language. Answer with the numbers of the titles that could be the kind of job they look for: the same \
work under another name or in another language counts ("Client Advisor" or "Collaborateur Magasin" for a shop seller; "Content Creator - \
Photo" for a photographer), and so does a close neighbour of their work at a similar level. Leave out other kinds of work (software, \
finance, marketing management, legal…), and titles with a word they ruled out. When unsure, include it: a later step scores each job."""


def _key(search):
    words = {'roles': sorted(str(w) for w in search.get('role_keywords') or []), 'out': sorted(str(w) for w in search.get('title_exclude_keywords') or [])}
    return hashlib.sha1(json.dumps(words, ensure_ascii=False).encode()).hexdigest()[:12]


def _norm(title):
    return ' '.join(str(title or '').lower().split())[:160]


def _load():
    try:
        return json.loads(STORE.read_text())
    except (OSError, ValueError):
        return {}


def known(search):
    """{title: True/False} decided for this search so far."""
    return _load().get(_key(search)) or {}


def decide(titles, search, client=None):
    """Ask about the titles not decided yet for this search (at most MAX_NEW), keep the answers; returns {title: fits} for all known."""
    from . import engine
    key, decided = _key(search), dict(known(search))
    ask = list(dict.fromkeys(t for t in (_norm(t) for t in titles) if t and t not in decided))[:MAX_NEW]
    if not ask:
        return decided
    client = client or engine.client(action='title_triage')
    from ..notion.search_settings import terms
    words = {'role_words': terms(search.get('role_keywords'))[:20], 'words_ruled_out': terms(search.get('title_exclude_keywords'))[:20]}
    from . import cost
    for start in range(0, len(ask), BATCH):
        batch = ask[start:start + BATCH]
        listed = '\n'.join(f'{n}. {title}' for n, title in enumerate(batch, 1))
        response = client.messages.create(model=MODEL, max_tokens=800, system=[{'type': 'text', 'text': SYSTEM}],
                                          messages=[{'role': 'user', 'content': f'The search (JSON): {json.dumps(words, ensure_ascii=False)}\nThe titles:\n{listed}'}],
                                          output_config=engine.structured(SCHEMA, MODEL, 'low'))
        cost.side(MODEL, response.usage)
        fit = {int(n) for n in json.loads(next(b.text for b in response.content if b.type == 'text')).get('fit') or [] if str(n).isdigit()}
        for n, title in enumerate(batch, 1):
            decided[title] = n in fit
    with LOCK:
        data = _load()
        data[key] = {**(data.get(key) or {}), **decided}
        for old in list(data)[:-3]:   # the last few searches only
            data.pop(old)
        STORE.parent.mkdir(parents=True, exist_ok=True)
        STORE.write_text(json.dumps(data, ensure_ascii=False))
    print(f'Titles: Claude sorted {len(ask)} new title(s) in your places; {sum(1 for t in ask if decided[t])} could fit your search')
    return decided
