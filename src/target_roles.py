"""Target roles: one list of job titles that is both what a job title must match and what job boards are searched for.

Stored as search.target_roles = [{title, also: [regex fragments], fragment?}] in config/search.json (and as one "Target roles" section of the Notion
⚙️ Search settings page). The two keys the engine reads, role_keywords (matched against posting titles) and jobs_board_search_queries (typed into
board search boxes), are derived from it: every title and its "also matches" variants are role keywords; the first SEARCHED titles are the searches.
A settings file from before 21 Oct 2026 has the two lists and no target_roles: `view` reads it as the same list (exact text only), and `migrate`
asks the AI once which short forms and spellings are the same job as a title, so "rn" becomes a variant of "registered nurse". Nothing is dropped.
Guarded by tests/test_target_roles.py; the desktop's twin of derive/view is desktop/lib/target-roles.js (tests/fixtures/target_roles_cases.json).
"""
import re

SEARCHED = 5   # titles typed into job boards (owner, 21 Oct 2026: 5, reorderable by moving a title up)
META = set('\\^$.|?*+()[]{}')
ESCAPED = re.compile(r'(?:[^\\^$.|?*+()\[\]{}]|\\[\\^$.|?*+()\[\]{}])+')
TOPIC = 'role_variant'
INSTRUCTIONS = ('Each item is a short job-title form from someone\'s job search, and the numbered job titles they already search for. '
                'Answer the number of the title that names the same job (an abbreviation, a spelling, a word order or a plainer name of it), '
                'or "none" when it is a different job.')


def title_fragment(title):
    """A typed title as the match fragment it stands for: lower case, regex characters escaped (the renderer's escapeFragment)."""
    return ''.join('\\' + c if c in META else c for c in ' '.join(str(title).split()).lower())


def _key(text):
    return ' '.join(str(text).split()).lower()


def plain_term(fragment):
    """The plain words of a fragment ("site reliability", "\\bsre\\b" -> "sre", "c\\+\\+" -> "c++"), or None when it needs its regex."""
    from .notion.search_settings import readable
    shown = readable(fragment).strip('"')
    if not shown.startswith('/'):
        return shown
    whole = re.fullmatch(r'\\b(.+)\\b', fragment)
    inner = whole.group(1) if whole else fragment
    return re.sub(r'\\(.)', r'\1', inner) if ESCAPED.fullmatch(inner) else None


def derive(roles, searched=SEARCHED):
    """(role_keywords, jobs_board_search_queries) of a target_roles list."""
    keywords, seen = [], set()
    for role in roles:
        for fragment in [role.get('fragment') or title_fragment(role['title']), *(role.get('also') or [])]:
            if fragment not in seen:
                seen.add(fragment)
                keywords.append(fragment)
    return keywords, [' '.join(role['title'].split()) for role in roles[:searched]]


def view(search):
    """The one list of a settings dict: target_roles when it has one, else the two old lists read as one by exact text (searches first, in order;
    a fragment that is no search's own fragment becomes its own title, one that has no plain words keeps its regex)."""
    if isinstance(search.get('target_roles'), list):
        return [{'title': ' '.join(role.split()), 'also': []} if isinstance(role, str) else dict(role) for role in search['target_roles']]   # plain titles: a draft or the example file
    roles, covered = [], set()
    for query in search.get('jobs_board_search_queries') or []:
        if _key(query) not in covered:
            covered.add(_key(query))
            roles.append({'title': ' '.join(str(query).split()), 'also': []})
    own = {title_fragment(role['title']) for role in roles}
    for fragment in search.get('role_keywords') or []:
        if fragment in own:
            continue
        term = plain_term(fragment)
        if term is not None and title_fragment(term) == fragment:
            if _key(term) not in covered:
                covered.add(_key(term))
                roles.append({'title': term, 'also': []})
        elif term is not None and _key(term) not in covered:
            covered.add(_key(term))
            roles.append({'title': term, 'also': [], 'fragment': fragment})   # a form the typed title would not match the same way (accents, whole word)
        else:
            roles.append({'title': f'/{fragment}/', 'also': [], 'fragment': fragment})
    return roles


def with_derived(search):
    """The settings with role_keywords and the searches written from the one list (the engine's two keys); a settings dict without roles is as it was."""
    roles = view(search)
    if not roles and 'target_roles' not in search:
        return search
    keywords, queries = derive(roles)
    return {**search, 'target_roles': roles, 'role_keywords': keywords, 'jobs_board_search_queries': queries}


def unmigrated(search):
    return not isinstance(search.get('target_roles'), list) and bool(view(search))


def migrate(search, client=None, ask=None):
    """The settings with target_roles written after the AI grouped the old role fragments under the searched titles, or None when it could not
    (no AI, a failure): the old two lists then keep working as they are and it is asked again next time. Cost: one small-model call, a few
    hundred tokens (under a cent), only when there are titles that no search names."""
    roles = view(search)
    searches = [role for role in roles[:len(search.get('jobs_board_search_queries') or [])]]
    extras = [role for role in roles if role not in searches]
    if not searches or not extras:
        return with_derived({**search, 'target_roles': roles})
    if ask is None:
        from .ai import decide
        ask = lambda items, answers: decide.decide(TOPIC, items, answers, INSTRUCTIONS, client=client)
    numbered = '; '.join(f'{i}: {role["title"]}' for i, role in enumerate(searches))
    items = {role['title']: f'Short form: "{role["title"]}". Titles: {numbered}' for role in extras}
    answers = ask(items, [str(i) for i in range(len(searches))] + ['none'])
    if answers is None:
        return None
    merged = [dict(role) for role in searches]
    for role in extras:
        answer = answers.get(role['title'])
        if answer is None:
            return None   # a partial answer is not a decision: all or nothing
        if answer.isdigit() and int(answer) < len(searches):
            merged[int(answer)]['also'] = [*merged[int(answer)]['also'], role.get('fragment') or title_fragment(role['title']), *role['also']]
        else:
            merged.append(role)
    return with_derived({**search, 'target_roles': merged})


def migrate_quietly():
    """Before a crawl: a settings file with two lists gets the one list; any failure leaves the file exactly as it was."""
    try:
        from .notion import search_settings
        files = search_settings.load_cached()
        if not unmigrated(files['search']):
            return False
        done = migrate(files['search'])
        if done is None:
            return False
        search_settings.apply({('search', ('target_roles',)): done['target_roles']}, files)
        print(f'Target roles: your roles and searches are one list now ({len(done["target_roles"])} titles).', flush=True)
        return True
    except Exception as error:  # noqa: BLE001 — the two old lists keep working
        from .ai.providers.contract import detail, reason
        print(f'Warning: roles not merged ({reason(error)}); keeping your two lists for now.', flush=True)
        detail('target roles', error)
        return False


def main(argv=None):
    """`migrate`: the app runs it once (lib/strategy-settings.js oneRolesList) and republishes the Notion page when it says "merged"."""
    import sys
    if (argv or sys.argv[1:] or [''])[0] == 'migrate':
        print('merged' if migrate_quietly() else 'unchanged')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
