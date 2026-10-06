"""'Explain with AI' on a jobs check that found few new jobs: Claude reads the search's coverage counts and says why, and what to do first.
Only when the user clicks (owner, 6 Oct 2026: the diagnosis's buttons after a search; the AI part on demand, so a check never spends AI on it).
What Claude sees: the user's role words and places, and counts (postings in the places, matched, what a missing word or a filter of theirs costs,
which job sources are not in use). Never the CV, the profile or a job's text. It answers in a fixed shape; the app shows the text as it is.
"""
import json

from . import engine

MODEL = 'claude-haiku-4-5'
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['why', 'first_steps'],
          'properties': {'why': {'type': 'string', 'description': 'Two or three plain sentences: why this search finds few new jobs'},
                         'first_steps': {'type': 'array', 'maxItems': 3, 'items': {'type': 'string'},
                                         'description': 'Up to three steps, easiest first, each one short sentence naming the exact word, filter, place or source'}}}
SYSTEM = """You help a job seeker understand why their automatic job search finds few new jobs, from the numbers of their last search. \
Be concrete and kind, plain words, no jargon. Name the exact role word, filter, place or job source from the numbers. Order the steps by \
effort: a click first (a role word to add, a filter of theirs to remove, a place to add), then a free key to add, then anything paid. Never \
invent a number, a source or a word that is not in the data."""


def facts(verdict, search):
    """The counts Claude is given: nothing about the person beyond their role words and places."""
    from ..notion.search_settings import terms
    verdict = verdict or {}
    places = search.get('locations') or {}
    pick = lambda items, keys: [{key: item.get(key) for key in keys} for item in items or []][:6]
    return {'role_words': terms(search.get('role_keywords'))[:15], 'places': terms([p for group in places.values() for p in group])[:10],
            'postings_in_places': verdict.get('in_places'), 'matched_by_role_words': verdict.get('matched'),
            'missing_role_words': pick(verdict.get('suggestions'), ('term', 'count')),
            'filters_hiding_jobs': pick(verdict.get('excluded'), ('fragment', 'count')) + pick(verdict.get('languages'), ('language', 'count')),
            'nearby_places': pick((verdict.get('places') or {}).get('options'), ('place', 'count')),
            'job_sources_not_used': pick(verdict.get('sources'), ('name', 'effort'))}


def explain(verdict, search, client=None):
    client = client or engine.client(action='few_jobs')
    response = client.messages.create(model=MODEL, max_tokens=800, system=[{'type': 'text', 'text': SYSTEM}],
                                      messages=[{'role': 'user', 'content': 'The numbers of the last search (JSON):\n' + json.dumps(facts(verdict, search), ensure_ascii=False)}],
                                      output_config=engine.structured(SCHEMA, MODEL, 'low'))
    from . import cost
    cost.side(MODEL, response.usage)
    answer = json.loads(next(block.text for block in response.content if block.type == 'text'))
    return {'why': str(answer.get('why') or '')[:600], 'first_steps': [str(step)[:200] for step in answer.get('first_steps') or []][:3]}
