"""'Filter for my search, then read' (owner, 7 Oct 2026: "the extension should know how to apply the filters, for the user's strategy, using
Claude"): on a job list the person opened in their own Chrome (LinkedIn, Indeed, an employer's site), the extension lists the page's filter
controls (labels and options only) and Claude picks which to set for this person's search; the extension applies them, then reads.

What Claude sees: the page's address and title, its controls (label, kind, options, state), and the search's role words, places, words that
rule a title out and languages that rule a job out. Never the CV, the profile, the page's text or anything typed on it. It answers with at
most MAX_STEPS steps on those controls only; the extension refuses anything else (apply, sign in, message, links away: extension/visit.js).
"""
import json

from . import engine

MODEL = 'claude-haiku-4-5'
MAX_STEPS = 8
MAX_CONTROLS = 60   # a short list answers in seconds (150 LinkedIn controls took 130 s, 7 Oct 2026)
ACTIONS = ('click', 'select', 'type')
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['steps', 'why'],
          'properties': {'why': {'type': 'string', 'description': 'One plain sentence: which filters were chosen and why'},
                         'steps': {'type': 'array', 'maxItems': MAX_STEPS, 'items': {
                             'type': 'object', 'additionalProperties': False, 'required': ['control', 'action', 'value'],
                             'properties': {'control': {'type': 'string', 'description': 'The id of one listed control'},
                                            'action': {'type': 'string', 'enum': list(ACTIONS)},
                                            'value': {'type': 'string', 'description': 'For select: one of its options; for type: the words; else ""'}}}}}}
SYSTEM = """You set the filters of a job search page for one job seeker, from their search settings. You get the page's filter controls \
(id, kind, label, options, whether it is already on) and the search. Choose only filters that narrow the list to jobs this person would \
want: their places (or remote, if their places say so), their kind of role (a keyword box: their main role word), recent jobs (posted in \
the past week or two weeks, or the past month when that is the shortest offered), and a level only when their words or exclusions make it \
clear (they exclude "intern" or "junior": do not pick those levels). Leave anything uncertain alone: fewer filters beat a wrong one. Use \
only listed ids. Never choose anything that applies to a job, signs in, saves, follows, messages, creates an alert or pays. When the page \
already shows the right filters, answer with no steps."""


def facts(search, preferences=None):
    """What Claude is told about the search: words and places the user wrote, nothing else about them."""
    from ..notion.search_settings import terms
    places = search.get('locations') or {}
    return {'role_words': terms(search.get('role_keywords'))[:10],
            'places_first': terms(places.get('top_tier'))[:6], 'places_also': terms((places.get('country_wide') or []) + (places.get('abroad') or []))[:6],
            'title_words_ruled_out': terms(search.get('title_exclude_keywords'))[:12],
            'languages_ruled_out': list((preferences or {}).get('disqualifying_languages') or [])[:6]}


def clean_controls(controls):
    """The page's controls in a fixed, small shape (the extension already leaves out anything it would never press)."""
    out = []
    for item in controls or []:
        if not isinstance(item, dict) or not str(item.get('id') or '').strip():
            continue
        out.append({'id': str(item['id'])[:40], 'kind': str(item.get('kind') or '')[:20], 'label': str(item.get('label') or '')[:120],
                    'options': [str(option)[:80] for option in (item.get('options') or [])][:25], 'on': bool(item.get('on'))})
    return out[:MAX_CONTROLS]


def plan(page, search, preferences=None, client=None):
    """{steps: [{control, action, value}], why} for this page: only listed controls and known actions; [] when nothing fits."""
    controls = clean_controls(page.get('controls'))
    if not controls:
        return {'steps': [], 'why': 'This page shows no filters to set.'}
    client = client or engine.client(action='visit_filters')
    ask = {'address': str(page.get('url') or '')[:300], 'title': str(page.get('title') or '')[:200], 'controls': controls, 'search': facts(search, preferences)}
    response = client.messages.create(model=MODEL, max_tokens=900, system=[{'type': 'text', 'text': SYSTEM}],
                                      messages=[{'role': 'user', 'content': 'The site, its filter controls and the search (JSON):\n' + json.dumps(ask, ensure_ascii=False)}],
                                      output_config=engine.structured(SCHEMA, MODEL, 'low'))
    from . import cost
    cost.side(MODEL, response.usage)
    answer = json.loads(next(block.text for block in response.content if block.type == 'text'))
    known = {control['id']: control for control in controls}
    steps = []
    for step in answer.get('steps') or []:
        control = known.get(str(step.get('control')))
        if not control or step.get('action') not in ACTIONS:
            continue
        value = str(step.get('value') or '')[:80]
        if step['action'] == 'select' and control['options'] and value not in control['options']:
            continue
        steps.append({'control': control['id'], 'action': step['action'], 'value': value, 'label': control['label']})
    return {'steps': steps[:MAX_STEPS], 'why': str(answer.get('why') or '')[:300]}
