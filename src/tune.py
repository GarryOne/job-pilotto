"""Tune my strategy (Actions page): what your own outcomes say about your search settings. Counts only, no AI.

Every job you acted on (an Applications row in Notion) is matched against config/search.json: the role terms its title
fits, the places its location fits. A term or place that only ever brought jobs you dismissed is proposed for removal; a
title word that keeps showing up in dismissed jobs and never in ones you kept is proposed as an exclusion. Nothing is
changed here: the app shows the proposals, and only the ones you accept are written (desktop/lib/strategy.js retune).
"""
from collections import Counter
import re

MIN_DISMISSED = 5          # a term needs this many dismissed jobs, and none kept, before it is called a miss
MAX_EXCLUDES = 3           # title words proposed per run: the strongest ones
NOT_ENGAGED = {None, '', 'Dismissed', 'Closed', 'Recruiter lead'}
INTERVIEWS = {'Screening', 'Interview scheduled', 'Interviewing', 'Offer'}
PLACE_LISTS = ('top_tier', 'country_wide', 'abroad')
WORD = re.compile(r'[^\W\d_]{4,}', re.U)
# Words that say nothing about the role on their own; a title word must carry meaning to be worth excluding.
FILLER = {'with', 'from', 'remote', 'hybrid', 'onsite', 'office', 'team', 'full', 'time', 'part', 'temporary', 'permanent',
          'contract', 'position', 'role', 'jobs', 'based', 'europe', 'global', 'international', 'level'}


def _matches(fragment, text):
    try:
        return bool(re.search(fragment, text or '', re.I))
    except re.error:
        return False


def _readable(fragment):
    return re.sub(r'\\[bB]|[\\^$()?]', '', fragment).replace('\\ ', ' ').strip()


def acted_jobs(db, stages):
    """The crawled jobs that have an Applications row: (title, location, stage)."""
    rows = db.execute('SELECT j.title, j.location, j.city, j.url FROM jobs j').fetchall()
    return [{'title': r['title'] or '', 'location': ' '.join(filter(None, [r['location'], r['city']])),
             'stage': stages[(r['url'] or '').strip()]} for r in rows if (r['url'] or '').strip() in stages]


def _tally(jobs):
    dismissed = sum(1 for j in jobs if j['stage'] == 'Dismissed')
    engaged = sum(1 for j in jobs if j['stage'] not in NOT_ENGAGED)
    interviews = sum(1 for j in jobs if j['stage'] in INTERVIEWS)
    return dismissed, engaged, interviews


def _miss(kind, list_name, fragment, jobs, what):
    dismissed, engaged, _ = _tally(jobs)
    if dismissed < MIN_DISMISSED or engaged:
        return None
    label = _readable(fragment)
    return {'id': f'{kind}:{list_name}:{fragment}', 'kind': kind, 'list': list_name, 'fragment': fragment, 'label': label,
            'dismissed': dismissed, 'engaged': 0,
            'why': f'{dismissed} {what} "{label}" jobs dismissed, none kept or applied to'}


def proposals(search, jobs):
    """The changes your outcomes support, strongest first."""
    found = []
    roles = search.get('role_keywords') or []
    for fragment in roles:
        hit = _miss('drop_role', 'role_keywords', fragment, [j for j in jobs if _matches(fragment, j['title'])], 'role')
        if hit:
            found.append(hit)
    # Never propose removing every role term or every place: the search would find nothing.
    found = found[:max(0, len(roles) - 1)]
    places = search.get('locations') or {}
    place_count = sum(len(places.get(name) or []) for name in PLACE_LISTS)
    dropped_places = []
    for name in PLACE_LISTS:
        for fragment in places.get(name) or []:
            hit = _miss('drop_place', name, fragment, [j for j in jobs if _matches(fragment, j['location'])], 'place')
            if hit:
                dropped_places.append(hit)
    found += dropped_places[:max(0, place_count - 1)]
    excluded = search.get('title_exclude_keywords') or []
    words = lambda title: {w.lower() for w in WORD.findall(title)} - FILLER
    kept = set().union(*(words(j['title']) for j in jobs if j['stage'] not in NOT_ENGAGED)) if jobs else set()
    counts = Counter(w for j in jobs if j['stage'] == 'Dismissed' for w in words(j['title']))
    for word, dismissed in counts.most_common():
        if len([p for p in found if p['kind'] == 'exclude_title']) >= MAX_EXCLUDES or dismissed < MIN_DISMISSED:
            break
        fragment = rf'\b{word}\b'
        if word in kept or any(_matches(f, word) for f in excluded) or any(_matches(word, _readable(r)) for r in roles):
            continue
        found.append({'id': f'exclude_title:title_exclude_keywords:{fragment}', 'kind': 'exclude_title',
                      'list': 'title_exclude_keywords', 'fragment': fragment, 'label': word, 'dismissed': dismissed, 'engaged': 0,
                      'why': f'"{word}" is in {dismissed} job titles you dismissed and in none you kept'})
    return sorted(found, key=lambda p: -p['dismissed'])


def run(db, tracker, search):
    """The Tune my strategy answer: proposals plus the counts they rest on."""
    stages = tracker.url_stages()
    jobs = acted_jobs(db, stages)
    dismissed, engaged, interviews = _tally(jobs)
    found = proposals(search, jobs)
    print(f'tune: {len(jobs)} acted jobs (dismissed {dismissed}, kept {engaged}, interviews {interviews}), '
          f'{len(found)} proposal(s)', file=__import__('sys').stderr)
    return {'ok': True, 'proposals': found, 'basis': {'jobs': len(jobs), 'dismissed': dismissed, 'engaged': engaged,
                                                      'interviews': interviews, 'min_dismissed': MIN_DISMISSED}}
