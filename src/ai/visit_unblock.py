"""Get unstuck (owner, 7 Oct 2026: "can it ask Claude how to proceed, to get unblocked?"): a page in the person's own Chrome that should show
a job list shows none, even after Claude's reading of its outline. The extension lists the page's ways on (buttons, links, search boxes:
label, kind, and a link's address) with its title and first lines of text; Claude picks at most MAX_STEPS steps that lead to the job list
for this search, or says the page needs the person (a sign-in, a check). The extension does the steps, then reads again.

What Claude sees: the page's address, title, its first lines of visible text, its ways on, and the search's role words and places. Never
the CV or the profile. It may only click, type, choose an option or open a link among those listed; the extension refuses again anything
that applies, signs in, messages, saves or pays (extension/visit.js NEVER).
"""
import json

from . import engine
from .visit_filters import facts

MODEL = 'claude-haiku-4-5'
SECOND_MODEL = 'claude-sonnet-5-5'   # once, when the fast model finds no way and does not say the page needs the person
MAX_STEPS = 2
MAX_WAYS = 80
ACTIONS = ('click', 'type', 'select', 'open')
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['steps', 'why', 'needs_person'],
          'properties': {'why': {'type': 'string', 'description': 'One plain sentence: what you do and why it leads to the jobs'},
                         'needs_person': {'type': 'string', 'description': 'Only when the page needs the person (a sign-in, a check, a payment): what, in a few words; else ""'},
                         'steps': {'type': 'array', 'maxItems': MAX_STEPS, 'items': {
                             'type': 'object', 'additionalProperties': False, 'required': ['control', 'action', 'value'],
                             'properties': {'control': {'type': 'string', 'description': 'The id of one listed way on'},
                                            'action': {'type': 'string', 'enum': list(ACTIONS)},
                                            'value': {'type': 'string', 'description': 'For type: the words; for select: one of its options; else ""'}}}}}}
SYSTEM = """A job seeker's browser is on a careers or job site that should show a list of jobs, but shows none. You get the page's \
address, title, first lines of text, and its ways on (id, kind, label, a link's address, a select's options), and the person's search. \
Choose at most two steps that lead to the list of jobs for this search, as a person would: close a box that covers the page (a newsletter, \
a pop-up; choose the person's country or language when the site asks for one), press a button that shows the jobs ("See all jobs", \
"Search", "View openings", "Show results"), open the link to the job list (careers, jobs, vacancies, offres, stellen, open positions), or \
type the main role word or the place into the site's job search box and then press its search button. Prefer opening a job-list link over \
anything else. Use only listed ids. Never sign in, sign up, apply, message, save, follow, subscribe, pay or answer a robot check: when \
the page needs one of those to go on, answer no steps and say it in needs_person. When nothing listed leads to jobs, answer no steps."""


def clean_ways(ways):
    """The page's ways on in a fixed, small shape (the extension already leaves out anything it would never press)."""
    out = []
    for item in ways or []:
        if not isinstance(item, dict) or not str(item.get('id') or '').strip():
            continue
        out.append({'id': str(item['id'])[:40], 'kind': str(item.get('kind') or '')[:20], 'label': str(item.get('label') or '')[:120],
                    'href': str(item.get('href') or '')[:200], 'options': [str(option)[:60] for option in (item.get('options') or [])][:15]})
    return out[:MAX_WAYS]


def plan(page, search, preferences=None, client=None, model=MODEL):
    """{steps: [{control, action, value, label, href}], why, needs_person}: only listed ways and known actions; no steps when nothing fits."""
    ways = clean_ways(page.get('ways'))
    if not ways:
        return {'steps': [], 'why': 'The page offers no way on.', 'needs_person': ''}
    client = client or engine.client(action='visit_unblock' if model == MODEL else 'visit_unblock_second')
    ask = {'address': str(page.get('url') or '')[:300], 'title': str(page.get('title') or '')[:200], 'text': str(page.get('text') or '')[:800],
           'ways': ways, 'search': facts(search, preferences)}
    response = client.messages.create(model=model, max_tokens=600, system=[{'type': 'text', 'text': SYSTEM}],
                                      messages=[{'role': 'user', 'content': 'The page, its ways on and the search (JSON):\n' + json.dumps(ask, ensure_ascii=False)}],
                                      output_config=engine.structured(SCHEMA, model, 'low'))
    from . import cost
    cost.side(model, response.usage)
    answer = json.loads(next(block.text for block in response.content if block.type == 'text'))
    known = {way['id']: way for way in ways}
    steps = []
    for step in answer.get('steps') or []:
        way = known.get(str(step.get('control')))
        action = step.get('action')
        if not way or action not in ACTIONS or (action == 'open' and not way['href'].startswith('https://')):
            continue
        value = str(step.get('value') or '')[:80]
        if action == 'select' and way['options'] and value not in way['options']:
            continue
        steps.append({'control': way['id'], 'action': action, 'value': value, 'label': way['label'], 'href': way['href'] if action == 'open' else ''})
    return {'steps': steps[:MAX_STEPS], 'why': str(answer.get('why') or '')[:300], 'needs_person': str(answer.get('needs_person') or '')[:120]}


def plan_twice(page, search, preferences=None, client=None, second_client=None):
    """plan() with the fast model, then once with SECOND_MODEL when it found no step and did not say the page needs the person."""
    planned = plan(page, search, preferences, client)
    planned['model'] = MODEL
    if planned['steps'] or planned['needs_person'] or not clean_ways(page.get('ways')):
        return planned
    second = plan(page, search, preferences, second_client, model=SECOND_MODEL)
    second['model'] = SECOND_MODEL
    return second
