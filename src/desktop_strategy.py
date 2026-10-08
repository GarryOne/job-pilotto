"""The Strategy page's data (strategy()), the Calendar's jobs and the sites-to-visit list (a pure move out of desktop.py).

Guarded by tests/test_strategy_goals.py, tests/test_desktop_notion_list.py, tests/test_visit_ats_feed.py, tests/test_opportunity.py.
"""
import json
import re
import sys

from . import digest, levels
from .ai import score
from .desktop_jobs import stage_status


COMPONENTS = (('role_fit', 'Role fit'), ('location', 'Location fit'), ('compensation', 'Compensation'),
              ('growth', 'Growth'), ('risk', 'Low risk'))


def _readable(fragment):
    """A search regex fragment as words ("z[uü]rich" -> "zürich", "\\bsre\\b" -> "sre")."""
    import re
    text = re.sub(r'\\b', '', str(fragment))
    text = re.sub(r'\[[^\]]*?([^\]])\]', r'\1', text)  # a letter choice: its last letter (z[uü]rich -> zürich)
    return re.sub(r'[.?*+()^$|\\]', '', text).strip()


def _section(profile, word):
    """The first line under the Profile heading that names `word` (e.g. Compensation), or ''."""
    lines, inside = profile.splitlines(), False
    for line in lines:
        if line.lstrip().startswith('#'):
            inside = word.lower() in line.lower()
            continue
        if inside and line.strip():
            return line.strip('- ').strip()
    return ''


# The setup goals as the Profile states them (desktop/renderer/markdown-edit.js GOAL_ROWS writes them): a table row "Work mode | …" or a
# line "Minimum acceptable: …". The Strategy page shows and corrects them as the setup review does (owner, 7 Oct 2026).
GOAL_ROWS = (('seniority', r'minimum seniority|seniority'), ('work_mode', r'^work mode$'), ('languages', r'languages i can work in'),
             ('minimum_salary', r'minimum acceptable|minimum salary'))


def _goals(profile):
    found = {}
    for line in (profile or '').splitlines():
        text = line.strip().strip('|').strip()
        cells = [cell.strip().strip('*').strip() for cell in text.split(' | ')] if ' | ' in text else None
        label, value = (cells[0], cells[1]) if cells and len(cells) > 1 else (text.lstrip('-* ').partition(':')[0], text.partition(':')[2])
        label = label.replace('**', '').strip()
        for key, pattern in GOAL_ROWS:
            if key not in found and value.strip() and re.search(pattern, label, re.I):
                found[key] = value.replace('**', '').strip()
    return found


def _quietly(call):
    try:
        return call()
    except Exception:  # noqa: BLE001
        return None


def feeds_remote_wanted(search):
    from .sources.feeds import remote_wanted
    return remote_wanted(search)


def strategy(db, tracker=None):
    """What the Strategy page shows, all from the user's own data: search settings (the cache of ⚙️ Search settings),
    preferences, the average fit components of the scored open jobs, counts, the Profile's compensation line and
    the latest 💡 Insight."""
    from . import role_kinds
    from .paths import CONFIG, load_search_config
    # The user's own words: with the regions and AI place words the crawl adds, the page listed a regex of every city as one "place".
    search = load_search_config(matching=False)
    try:
        prefs = json.loads((CONFIG / 'preferences.json').read_text())
    except (OSError, ValueError):
        prefs = {}
    unique = lambda items: list(dict.fromkeys(i for i in (_readable(x) for x in items or []) if i))
    places = search.get('locations') or {}
    candidates, _ = digest.eligible_jobs(db)
    fits = score.load(db)
    scored = [fits[job['id']] for job in candidates if job['id'] in fits]
    components = []
    for key, label in COMPONENTS:
        values = [fit['components'][key] for fit in scored if isinstance(fit.get('components'), dict) and key in fit['components']]
        if values:
            average = round(sum(values) / len(values))
            components.append({'key': key, 'label': label, 'value': 100 - average if key == 'risk' else average})  # risk: lower is better
    stages = {}
    insight, compensation, goals, profile = None, '', {}, None
    if tracker:
        from .ai.insights import INSIGHTS_DATABASE_ID
        from .notion.client import together

        def latest_insight():
            if not INSIGHTS_DATABASE_ID:
                return []
            rows = tracker._request('POST', f'databases/{INSIGHTS_DATABASE_ID}/query',
                                    {'page_size': 5, 'sorts': [{'timestamp': 'created_time', 'direction': 'descending'}]})['results']
            # The Interviews page's own row is not a strategy insight. Skipped here, not in a Notion filter: a filter on
            # an option the workspace doesn't have yet (before the schema repair) is refused with a 400.
            from .notion.ledger import plain
            return [r for r in rows if plain((r.get('properties') or {}).get('Category')) != 'Interview patterns'][:1]
        quiet = lambda call: lambda: _quietly(call)  # a failed read leaves its part empty; the rest still shows
        url_stages, profile, rows = together(quiet(tracker.url_stages), quiet(tracker.page_text), quiet(latest_insight))
        for stage in (url_stages or {}).values():
            stages[stage] = stages.get(stage, 0) + 1
        goals = _goals(profile)
        compensation = goals.get('minimum_salary') or _section(profile or '', 'compensation') or _section(profile or '', 'salary')
        if rows:
            from .notion.ledger import plain
            props = rows[0]['properties']
            insight = {'headline': plain(props.get('Insight')) or '', 'action': plain(props.get('Action')) or '',
                       'url': rows[0].get('url', '')}
    from .paths import local_profile
    # Trying (no Notion): the Profile is on this Mac. Also when Notion gave no Profile and the app passed a local one (only in Trying or the demo,
    # whose Notion is fictional: desktop/lib/pipeline.js), so the demo's goals show.
    if not tracker or (profile is None and local_profile()):
        goals = _goals(local_profile() or '')
        compensation = goals.get('minimum_salary') or _section(local_profile() or '', 'compensation')
    stale = 0
    if tracker:  # jobs whose fit score waits for the new Profile ("Scores updating"), re-scored over the next searches
        try:
            from .paths import local_profile
            stale = score.stale_count(db, candidates, local_profile() or tracker.page_text())
        except Exception:  # noqa: BLE001
            pass
    # The Profile still the empty template (an import or a new workspace): fit scores are paused (score.unfilled); the page says so.
    from .paths import local_profile
    own = local_profile()
    profile_empty = score.unfilled(own) if own else (score.unfilled(profile) if tracker and profile is not None else False)
    sent = sum(n for stage, n in stages.items() if stage not in ('Saved', 'Kit ready', 'Applying', 'Dismissed', 'Closed', 'Recruiter lead'))
    return {
        'roles': unique(search.get('jobs_board_search_queries') or search.get('role_keywords')),
        # The top cities, the country, the cities abroad (the long lists of nearby towns and spellings stay out).
        'locations': unique((places.get('top_tier') or [])[:3] + (places.get('country_wide') or [])[:1] + (places.get('abroad') or [])),
        'stack': unique(search.get('quality_stack_keywords'))[:8],
        # The same lists in full, for editing them on the Strategy page: each entry as stored (removing sends it back) and as words.
        # Roles carry their kind (src/role_kinds.py), so the Strategy page groups them into families (Retail, Logistics…).
        'lists': {name: [{'fragment': str(item), 'label': _readable(item), **({'kind': role_kinds.kind_of(_readable(item))} if name == 'roles' else {})}
                         for item in items or [] if _readable(item)]
                  for name, items in (('roles', search.get('role_keywords')), ('places', places.get('top_tier')),
                                      ('country', places.get('country_wide')), ('abroad', places.get('abroad')),
                                      ('stack', search.get('quality_stack_keywords')), ('rights', prefs.get('work_rights')))},
        # Plain lists, shown as written: board search phrases and the languages that hide a job.
        'texts': {'queries': [str(q) for q in search.get('jobs_board_search_queries') or []],
                  'languages': [str(q) for q in prefs.get('disqualifying_languages') or []]},
        'remote_jobs': feeds_remote_wanted(search),
        'goals': goals,
        'level': levels.level_of(search.get('level')),
        'compensation': compensation,
        'avoid': [f'Requires {language}' for language in prefs.get('disqualifying_languages') or []]
                 + [f'Company: {name}' for name in prefs.get('excluded_companies') or []]
                 + [f'Title: {word}' for word in unique(search.get('title_exclude_keywords'))[:6]]
                 + [f'Remote only from {region}' for region in unique(search.get('remote_excluded_regions'))[:3]],
        'components': components, 'scored': len(scored), 'stale': stale, 'previous': len(score.previous_method(db)), 'profile_empty': profile_empty,
        'counts': {'matches': len(scored), 'kits': stages.get('Kit ready', 0), 'sent': sent},
        'insight': insight,
    }


def calendar_jobs(tracker):
    """What the Calendar reads from a job: its Next interview, and the fields a meeting shows. Applications rows only, so it
    skips the Job Matches database (every job a search found), which made the page wait ~10 s for a list it barely used."""
    if not tracker:
        return {'jobs': [], 'error': 'Notion is not connected.'}
    try:
        found = tracker.notion_jobs(matches=False)
    except Exception as error:  # noqa: BLE001 — shown on the page; the saved copy stays
        return {'jobs': [], 'error': f'Notion could not be read ({type(error).__name__}).'}
    keep = ('url', 'title', 'company', 'stage', 'notion_url', 'next_interview')
    return {'jobs': [{**{key: job.get(key) or '' for key in keep}, 'status': stage_status(job.get('stage'))} for job in found]}


def _visits(search):
    """Sites only you can open, for the Strategy card and the "Few new jobs" chips (src/sources/visits.py)."""
    from . import role_kinds
    from .sources import visits
    try:
        return visits.visit_list(search, role_kinds.of_search(search))
    except Exception as error:  # noqa: BLE001 — said, then no chips
        print(f'Warning: sites to visit not listed ({type(error).__name__}: {error})', file=sys.stderr)
        return []
