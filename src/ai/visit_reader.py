"""How to read a job list on any site, learned once (owner, 7 Oct 2026: "intelligent enough to adapt on any website, no hard-coded
behaviours"). The extension sends an outline of a page it could not read with its quick guess: its groups of repeated blocks (each with a CSS
path, a count and three samples of their text lines and links) and the controls that look like paging. Claude answers with a recipe: which
group is the job list, which line of a block is the title, the employer and the place, which link is the job, and how to reach the next
page. The recipe is kept per site (src/sources/visits.py) and replayed by the extension with no AI until it stops finding jobs.

What Claude sees: the outline (a few sample blocks of a public job list, capped), never the CV or anything about the person.
"""
import json

from . import engine
from .models import MAIN_MODEL, SMALL_MODEL

MODEL = SMALL_MODEL
# The second try when the first model finds nothing (owner, 7 Oct 2026: "Sonnet as a 2nd try"): one page, only on a failure, logged.
SECOND_MODEL = MAIN_MODEL
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['group', 'title', 'company', 'place', 'link', 'next', 'why'],
          'properties': {'group': {'type': 'string', 'description': 'The id of the group whose blocks are job postings, or "" if none is'},
                         'title': {'type': 'integer', 'description': "The index of the block's text line holding the job title; -1: the job link's own text"},
                         'company': {'type': 'integer', 'description': 'Index of the line holding the employer, -1 if none'},
                         'place': {'type': 'integer', 'description': 'Index of the line holding the place, -1 if none'},
                         'link': {'type': 'integer', 'description': "Which of the block's links opens the job (0 = first)"},
                         'next': {'type': 'string', 'description': 'The exact label of the paging control that goes to the next page; "number" when the pages are numbered '
                                                                     'without a next control; "scroll" when more jobs load as you scroll; "none" when there is one page'},
                         'why': {'type': 'string', 'description': 'One short sentence'}}}
SYSTEM = """You read the outline of a web page that should list job postings: groups of repeated blocks, with samples of their text lines \
and links, and the page's paging controls. Pick the group whose blocks are job postings (titles of jobs, often with an employer and a \
place), not menus, filters, articles or footers. Give the index of the line with the job title, the employer and the place in a block, \
which of its links opens the job, and how to go to the next page of the list, using an exact label from the paging controls. If no group \
lists jobs, answer group "". Never invent a label or an index."""


def understand(outline, client=None, model=MODEL):
    """{selector, title, company, place, link, next, why} for this page, or None when no group holds jobs. Checked against the outline."""
    groups = {str(group.get('id')): group for group in (outline.get('groups') or [])[:12] if isinstance(group, dict)}
    if not groups:
        return None
    client = client or engine.client(action='visit_reader' if model == MODEL else 'visit_reader_second')
    ask = {'address': str(outline.get('url') or '')[:300], 'title': str(outline.get('title') or '')[:200],
           'groups': [{'id': key, 'count': group.get('count'), 'samples': (group.get('samples') or [])[:3]} for key, group in groups.items()],
           'paging_controls': [str(item.get('label'))[:30] for item in (outline.get('pager') or [])[:25] if isinstance(item, dict)]}
    response = client.messages.create(model=model, max_tokens=1500, system=[{'type': 'text', 'text': SYSTEM}],
                                      messages=[{'role': 'user', 'content': 'The page outline (JSON):\n' + json.dumps(ask, ensure_ascii=False)[:30000]}],
                                      output_config=engine.structured(SCHEMA, model, 'low'))
    from . import cost
    cost.side(model, response.usage)
    answer = json.loads(next(block.text for block in response.content if block.type == 'text'))
    group = groups.get(str(answer.get('group') or ''))
    if not group:
        return None
    lines = max((len(sample.get('lines') or []) for sample in group.get('samples') or []), default=0)
    index = lambda value: value if isinstance(value, int) and -1 <= value < max(lines, 1) else -1  # noqa: E731
    labels = {str(item.get('label')) for item in outline.get('pager') or [] if isinstance(item, dict)}
    nxt = str(answer.get('next') or 'none')
    if nxt not in ('number', 'scroll', 'none') and nxt not in labels:
        nxt = 'none'   # a label the page does not have: no paging rather than a wrong click
    return {'selector': str(group['selector'])[:300], 'title': index(answer.get('title')), 'company': index(answer.get('company')),
            'place': index(answer.get('place')), 'link': max(0, min(int(answer.get('link') or 0), 5)), 'next': nxt[:30], 'why': str(answer.get('why') or '')[:200]}


def understand_twice(outline, client=None, second_client=None):
    """understand() with the fast model, then once with SECOND_MODEL when it found no job list on a page that has groups to read. Returns
    (recipe, which model found it or '')."""
    recipe = understand(outline, client)
    if recipe:
        return recipe, MODEL
    if not (outline.get('groups') or []):
        return None, ''
    recipe = understand(outline, second_client, model=SECOND_MODEL)
    return recipe, (SECOND_MODEL if recipe else '')
