#!/usr/bin/env python3
"""JSON commands for the desktop app (desktop/), which runs this package as a local helper.

    python -m src.desktop jobs [--limit 200]     ranked open jobs with fit score and application status
    python -m src.desktop status <URL> <status>  record an application status locally (applied, saved, dismissed)
    python -m src.desktop posting <code>         one job's posting (title, company, description) for CV tailoring
    python -m src.desktop strategy               the Strategy page: targets, how matches score, what's avoided, counts

The app sets JOB_PILOTTO_CONFIG_DIR / JOB_PILOTTO_DATA_DIR / JOB_PILOTTO_PROFILE_FILE, so everything
here reads and writes the user's own folder. Output is one JSON document on stdout.
"""
import argparse
import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

from . import digest, levels, store
from .ai import provenance, score
from .notion.client import job_code
from .paths import JOBS_DB

STATUSES = ('unreviewed', 'saved', 'applied', 'dismissed')


# Notion Applications Stage -> the app's status. With Notion connected the Stage is the only source of truth;
# the local applications.status column is a cache refreshed from it on every list.
def stage_status(stage):
    if not stage or stage == 'Kit ready':
        return 'unreviewed'
    if stage in ('Saved', 'Recruiter lead'):  # a recruiter's pitch you haven't answered yet: worth a look, not applied
        return 'saved'
    if stage in ('Dismissed', 'Closed'):
        return 'dismissed'
    return 'applied'  # Applying, Applied and everything after it (replies, interviews, rejection, offer)


NOT_ELIGIBLE = '⛔ Not eligible: '
GONE = ('Not seen', 'Closed')  # Job Matches statuses of postings no longer listed
# Applications stages that don't keep a gone posting in the list: not applied yet (owner, 7 Oct 2026: a refresh removes jobs that are at most
# saved or have a prepared kit; applied, interviewing and the rest stay).
NOT_YET = ('', 'Saved', 'Kit ready')


def _kit(stage, step):
    return stage == 'Kit ready' or step.startswith(('📝 Kit ready', NOT_ELIGIBLE))


def jobs(db, limit=200, stages=None, notion=False, notion_jobs=None, kit_inputs=None, hide_unscored=False):
    """The Jobs list, best fit first (unscored after scored, then the rule-based rank).

    notion_jobs (Tracker.notion_jobs): the list itself, from Notion (the source of truth), with Notion's fields only;
    the cache is kept in step with it, and adds only jobs a search found but couldn't write to Notion yet (marked
    unsynced). Without it (Notion unreachable, or not connected) the list comes from the cache, marked stale.
    stages: job URL -> (Stage, Next step, page URL), for the cache-only list."""
    stages = stages or {}
    waiting = 0
    candidates, blocked = digest.eligible_jobs(db)
    fits = score.load(db)
    local = {(job.get('url') or '').strip(): job for job in candidates}
    # A link you added stays in the list even when a crawl would have filtered that company or that wording out.
    asked = {(job.get('url') or '').strip() for job in candidates + blocked if (job.get('notes') or '') == 'imported'}
    hidden = {(job.get('url') or '').strip() for job in blocked} - asked
    # Deleted here (delete_job): left out even while Notion's query still returns its trashed page (it lags; the totals settled 3 refreshes later).
    hidden |= _deleted_urls(db)
    # Closed on this Mac (gone from its site, or outside your places) while its Notion row still says Open: Notion is told at the end of the
    # refresh; the list leaves it out now, so the count drops as the refresh works (owner, 7 Oct 2026). A job you acted on stays (NOT_YET).
    try:
        closed_here = {(row[0] or '').strip() for row in db.execute("SELECT url FROM jobs WHERE state = 'closed'")}
    except sqlite3.Error:   # a test's bare database
        closed_here = set()
    rows = []

    def row(job, fit, reason, status, stage, step, page, **extra):
        return {'id': job.get('id'), 'code': job_code(job['url']) if job.get('url') else '',
                'title': job.get('title') or '', 'company': job.get('company') or '', 'location': job.get('location') or '',
                'work_mode': job.get('work_mode') or '', 'url': job.get('url') or '',
                'posted_at': job.get('posted_at') or '', 'first_seen_at': job.get('first_seen_at') or '',
                'status': status, 'fit': fit, 'reason': reason or '', 'rank': digest.rank_score(job) if job.get('id') else 0,
                'notion_url': page or '',  # the job's Applications page: kit, verdict, notes
                'stage': stage or '',  # the Applications Stage (Applied, Interviewing, Rejected…): the app's application counters
                # A kit writes Next step (Kit ready / Not eligible); the stage can stay Saved if the job was starred first.
                'kit': _kit(stage, step or ''),
                'ineligible': step[len(NOT_ELIGIBLE):] if (step or '').startswith(NOT_ELIGIBLE) else '', **extra}

    if notion_jobs is not None:
        seen = set()
        for item in notion_jobs:
            url, stage = item['url'], item.get('stage')
            seen.add(url)
            if url in hidden or (digest.company_excluded(item) and url not in asked) or (
                    (item.get('match_status') in GONE or url in closed_here) and (stage or '') in NOT_YET):
                continue
            status = stage_status(stage) if stage else {'Applied': 'applied', 'Dismissed': 'dismissed'}.get(item.get('match_status'), 'unreviewed')
            cached = local.get(url)
            if cached and status != (cached.get('application_status') or 'unreviewed'):  # keep the cache in step
                store.set_application_status(db, cached['id'], status)
            # Only Notion's fields: a field the list needs is a Notion column (config/notion_schema.json), never cache-only.
            job = {'url': url, 'title': item.get('title'), 'company': item.get('company'), 'location': item.get('location'),
                   'work_mode': item.get('work_mode'), 'first_seen_at': item.get('first_seen', '')}
            # A kit's inputs vs today's: current, earlier (drafted before the CV, Profile or answers changed), unknown.
            kit_state = provenance.kit_state(item.get('kit_inputs'), kit_inputs) if _kit(stage, item.get('next_step') or '') else ''
            rows.append(row(job, item.get('fit'), item.get('reason'), status, stage, item.get('next_step'), item.get('notion_url'),
                            rejection=item.get('rejection') or '', rejection_lesson=item.get('rejection_lesson') or '',
                            feedback_status=item.get('feedback_status') or '', employer_feedback=item.get('employer_feedback') or '',
                            page_id=item.get('page_id') or '', fit_detail=item.get('fit_detail') or None,
                            kit_state=kit_state, next_interview=item.get('next_interview') or '',
                            # Outbound or inbound (desktop/renderer/origin.js), and what the "In conversation" rows show.
                            origin=item.get('origin') or '', source=item.get('source') or '', notes=item.get('notes') or '',
                            applied_on=item.get('applied_on') or '',
                            via=item.get('via') or '', next_step=item.get('next_step') or ''))
        for url, job in local.items():  # found by a search, not in Notion yet (its sync failed): shown, marked
            if url and url not in seen:
                fit = fits.get(job['id'])
                # Found, not read and scored yet: a refresh takes them a batch at a time (src/daily.py), so they wait, counted, not listed as
                # matches (owner, 7 Oct 2026: half the list showed "–"). Without an AI nothing would ever score them: then they are listed.
                if hide_unscored and not fit and (job.get('application_status') or 'unreviewed') == 'unreviewed' and (job.get('notes') or '') != 'imported':
                    waiting += 1
                    continue
                rows.append(row(job, fit.get('score') if fit else None, (fit.get('summary') or fit.get('reason')) if fit else '',
                                job.get('application_status') or 'unreviewed', None, '', '', unsynced=True, fit_detail=_fit_detail(fit)))
    else:
        def notion_row(job):  # (Stage, Next step, Notion page URL); tests may pass plain stages
            value = stages.get((job.get('url') or '').strip(), (None, '', ''))
            return (tuple(value) + ('', ''))[:3] if isinstance(value, tuple) else (value, '', '')
        for job in candidates:
            fit = fits.get(job['id'])
            stage, step, page = notion_row(job)
            if notion:  # Notion wins; keep the local cache in step
                truth = stage_status(stage)
                if truth != (job.get('application_status') or 'unreviewed'):
                    store.set_application_status(db, job['id'], truth)
                    job = {**job, 'application_status': truth}
            rows.append(row(job, fit.get('score') if fit else None, (fit.get('summary') or fit.get('reason')) if fit else '',
                            job.get('application_status') or 'unreviewed', stage, step, page, fit_detail=_fit_detail(fit)))
    rows.sort(key=lambda r: (r['fit'] is not None, r['fit'] or 0, r['rank']), reverse=True)
    # Every application stays in the list, however low its fit, so the app's application counters are complete.
    kept = rows[:limit] + [r for r in rows[limit:] if r['status'] == 'applied']
    # New this week among the rows not sent: the app adds them to its own count, so a cut list's counts stay whole (7 Oct 2026: "200 new
    # this week" of 1,335). Rows past `limit` are unscored or low-fit job matches, never applications.
    week = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
    return {'jobs': kept, 'total': len(rows), 'filtered': len(blocked), 'waiting': waiting,
            'review_beyond': sum(1 for r in rows[limit:] if r['status'] == 'unreviewed'),   # the Jobs badge counts them too
            'week_beyond': sum(1 for r in rows[limit:] if r['status'] != 'applied' and (r.get('first_seen_at') or '')[:10] >= week)}


def posting(db, code):
    """The job whose code (job_code of its URL) is given, with the posting text stored by the crawl."""
    rows = db.execute("""SELECT jobs.title, jobs.url, jobs.location, jobs.description, companies.name company
                          FROM jobs JOIN companies ON companies.id=jobs.company_id WHERE jobs.url IS NOT NULL""").fetchall()
    for row in rows:
        if job_code(row['url']) == code:
            return {'ok': True, 'code': code, 'title': row['title'], 'company': row['company'], 'url': row['url'],
                    'location': row['location'] or '', 'description': row['description'] or ''}
    return {'ok': False, 'error': 'job not found'}


NO_POSTING = 'This job has no description yet. Add it first (⋯ → Log job activity, or paste it in the job page), then tailor.'
MIN_POSTING = 200  # characters that really describe the role (prep.about_role): a Teams invite or a greeting is not a posting


def notion_posting(tracker, code):
    """A job that only exists in Notion (a recruiter's message, a LinkedIn chat pasted as screenshots, Add details): its
    posting is the description saved on its page (inbox.py / prep.py). {'ok': False, 'error'} says what is missing."""
    from .ai import prep
    item = next((j for j in tracker.notion_jobs() if j.get('url') and job_code(j['url']) == code), None)
    row = tracker.find(item['url']) if item else None
    if not row:
        return {'ok': False, 'error': 'job not found'}
    text = prep.role_text(tracker, row)
    if prep.about_role(text) < MIN_POSTING:
        return {'ok': False, 'error': NO_POSTING}
    return {'ok': True, 'code': code, 'title': item['title'], 'company': item.get('company') or item.get('via') or '', 'url': item['url'],
            'location': item.get('location') or '', 'description': text}


NOTION_STAGES = {'saved': 'Saved', 'applied': 'Applied', 'dismissed': 'Dismissed'}


class InProcess(Exception):
    pass


def _mark(tracker, job, status):
    """Write the status as an Applications stage. Returns (outcome, stage now in Notion, or None when it is not known).
    Notion keeps a real application stage (Interview scheduled, Applied...) against Saved/Dismissed (a Telegram misfire
    must not close an application), so a Dismiss the person clicked here closes the job instead; Saved on one is
    refused: telling the person it worked while Notion kept its stage is what made a dismissed interview come back."""
    page, outcome = tracker.mark(job, NOTION_STAGES[status])
    current = (((page or {}).get('properties') or {}).get('Stage', {}).get('select') or {}).get('name')
    if outcome != 'unchanged' or not current or current == NOTION_STAGES[status] or stage_status(current) != 'applied':
        return outcome, NOTION_STAGES[status] if outcome != 'unchanged' else current
    if status == 'dismissed':
        _, outcome = tracker.mark(job, 'Closed')
        return outcome, 'Closed'
    raise InProcess(f'It is already in process ({current}), so it can not be saved. Dismiss it to close it.')


def set_status(db, url, status, tracker=None):
    """Record the status locally and, with Notion connected, as the job's Applications stage (the source
    of truth; Saved/Dismissed never overwrite a real application stage, see Tracker.mark)."""
    row = db.execute("""SELECT jobs.id, jobs.title, jobs.url, jobs.location, jobs.posted_at, jobs.first_seen_at,
                                 companies.name company FROM jobs JOIN companies ON companies.id=jobs.company_id
                          WHERE jobs.url=?""", (url,)).fetchone()
    if not row and tracker and status in NOTION_STAGES:  # a job only in Notion (no local copy): Notion alone
        item = next((j for j in tracker.notion_jobs() if j['url'] == url), None)
        if not item:
            return {'ok': False, 'error': 'job not found'}
        try:
            outcome, stage = _mark(tracker, {'title': item['title'], 'company': item['company'], 'location': item['location'],
                                             'url': url, 'posted_at': '', 'first_seen_at': item.get('first_seen', '')}, status)
        except InProcess as error:
            return {'ok': False, 'error': str(error)}
        except Exception as error:  # noqa: BLE001
            return {'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing changed. Try again.'}
        return {'ok': True, 'notion': outcome, 'stage': stage}
    if not row:
        return {'ok': False, 'error': 'job not found'}
    outcome = stage = None
    if tracker and status in NOTION_STAGES:  # Notion first: if it can't be written, nothing changes
        try:
            outcome, stage = _mark(tracker, dict(row), status)
        except InProcess as error:
            return {'ok': False, 'error': str(error)}
        except Exception as error:  # noqa: BLE001 — shown to the user; the local cache stays as it was
            return {'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing changed. Try again.'}
    store.set_application_status(db, row['id'], 'dismissed' if stage == 'Closed' else status)
    db.commit()
    return {'ok': True, 'notion': outcome, 'stage': stage} if outcome else {'ok': True}


def _deleted_urls(db):
    """Jobs deleted on this Mac (delete_job); none in a store without its tables yet."""
    try:
        return {row[0] for row in db.execute("SELECT url FROM jobs WHERE state='deleted'")}
    except sqlite3.OperationalError:
        return set()


def _matches_rows(db, url):
    """The job's Job Matches page ids kept by the Notion sync ([] before its first sync: the table is the sync's own)."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notion_matches'").fetchone():
        return []
    return db.execute("SELECT page_id FROM notion_matches WHERE url=?", (url,)).fetchall()


def delete_job(db, url, tracker=None):
    """Delete a job you dismissed (owner, 7 Oct 2026: two Anthropic rows a Gmail check had made by itself): its Applications and Job Matches
    pages go to Notion's trash (restorable there for 30 days), and the local copy becomes a marker so no search brings it back. Only a dismissed
    job: anything else is still a job you might act on."""
    row = db.execute("""SELECT jobs.id, COALESCE(applications.status, 'unreviewed') status FROM jobs
                        LEFT JOIN applications ON applications.job_id=jobs.id WHERE jobs.url=?""", (url,)).fetchone()
    found = tracker.find(url) if tracker else None
    stage = ((found or {}).get('properties', {}).get('Stage', {}).get('select') or {}).get('name', '') if found else ''
    if not row and not found:
        return {'ok': False, 'error': 'job not found'}
    if (row and row['status'] != 'dismissed' and not stage) or (stage and stage not in ('Dismissed', 'Closed')):
        return {'ok': False, 'error': 'Dismiss it first: only a dismissed job can be deleted.'}
    trashed = 0
    if tracker:
        try:
            pages = [found['id']] if found else []
            pages += [r['page_id'] for r in _matches_rows(db, url) if r['page_id']]
            for page in pages:
                tracker.trash_page(page)
                trashed += 1
        except Exception as error:  # noqa: BLE001 — shown to the user; nothing local changes
            return {'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing was deleted. Try again.'}
    if row:
        store.delete_job(db, row['id'])
        if _matches_rows(db, url):
            db.execute("DELETE FROM notion_matches WHERE url=?", (url,))
        db.commit()
    return {'ok': True, 'trashed': trashed}


def _fit_detail(fit):
    """A local score's parts, strengths and gaps, in the shape Notion's Job Matches row gives (the score card)."""
    if not fit:
        return None
    joined = lambda items: '; '.join(items) if isinstance(items, list) else (items or '')
    return {'strengths': joined(fit.get('strengths')), 'gaps': joined(fit.get('gaps')),
            'parts': {key: (fit.get('components') or {}).get(key) for key in ('role_fit', 'location', 'compensation', 'growth', 'risk')}}


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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    listing = sub.add_parser('jobs')
    listing.add_argument('--limit', type=int, default=200)
    sub.add_parser('delete').add_argument('url')   # a dismissed job: its Notion pages to the trash, the local copy a marker (delete_job)
    marking = sub.add_parser('status')
    marking.add_argument('url')
    marking.add_argument('status', choices=STATUSES)
    sub.add_parser('unapply').add_argument('url')  # a session ended without a submission: Applying -> Kit ready
    sub.add_parser('not-submitted').add_argument('url')  # an Applied was wrong: back to Applying (never a stage with evidence)
    sub.add_parser('posting').add_argument('code')
    sub.add_parser('calendar')   # the Calendar's jobs: Applications rows only, no search cache (a fraction of `jobs`)
    sub.add_parser('strategy')
    sub.add_parser('rescore-previous')
    sub.add_parser('tune')   # Tune my strategy: what your outcomes say about the search settings (src/tune.py)
    sub.add_parser('explain-coverage')   # 'Explain with AI' on a jobs check with few new jobs (src/ai/few_jobs.py): on the user's click only
    sub.add_parser('visit-outcome').add_argument('file')   # a browser run's results (JSON [{url, ok, why}]): failures remembered (src/sources/visits.py)
    sub.add_parser('visit-hide').add_argument('url')   # you removed this site from the list: not offered again
    sub.add_parser('visit-list')   # sites only you can open (src/sources/visits.py): refusing employers and portals, least recently read first
    sub.add_parser('visit-unblock').add_argument('file')   # a page with no job list (JSON: url, title, text, ways): at most 2 steps toward it, or "needs you"
    sub.add_parser('visit-filters').add_argument('file')   # a page's filter controls (JSON: url, title, controls): which to set for this search (src/ai/visit_filters.py)
    sub.add_parser('visit-context').add_argument('file')   # for a "Read with Claude" session: the search's own role words and places (plain words)
    sub.add_parser('visit-session').add_argument('session')   # what a Read with Claude session saved (its session name): jobs, matching
    sub.add_parser('visit-jobpages').add_argument('file')   # sites about to be read (JSON [{name, url, kind}]): their job pages, a web search each when unknown
    sub.add_parser('visit-jobpage').add_argument('file')   # a page that is not a job list (JSON: url, html): the job list's address, kept per site
    sub.add_parser('visit-read').add_argument('file')
    sub.add_parser('visit-understand').add_argument('file')   # a page outline the extension could not read: Claude's recipe, kept per site
    sub.add_parser('visit-recipe').add_argument('file')   # the recipe kept for a site (JSON: url, forget), or null   # a page the extension sent (JSON: url, html, cards, title, session): its jobs, kept as a feed
    sub.add_parser('role-ideas').add_argument('file', nargs='?')   # roles suggested from the Profile (JSON: set_aside), counted in the places' titles
    sub.add_parser('coverage')   # how much of the market the role keywords catch, and what adding a term would add (src/coverage.py)
    args = parser.parse_args(argv)
    with store.connect(JOBS_DB) as db:
        if args.command == 'posting':
            found = posting(db, args.code)
            if not found['ok']:  # not in the crawl: a job kept only in Notion
                try:
                    from .notion.client import Tracker
                    tracker = Tracker.from_env()
                    found = notion_posting(tracker, args.code) if tracker else found
                except Exception as error:  # noqa: BLE001 — the first answer ("job not found") stays when Notion can't be read
                    print(f'Notion posting not read: {type(error).__name__}: {error}', file=sys.stderr)
            print(json.dumps(found, ensure_ascii=False))
            return 0
        if args.command == 'explain-coverage':
            from . import coverage
            from .ai import few_jobs
            from .paths import load_search_config
            search = load_search_config()
            places = search.get('locations') or {}
            said = coverage.verdict(coverage.load(), search.get('role_keywords') or [], [f for group in places.values() for f in group],
                                    search.get('title_exclude_keywords') or [])
            if said is not None:
                said['languages'] = coverage.language_drops()
            print(json.dumps(few_jobs.explain(said, search), ensure_ascii=False))
            return 0
        if args.command == 'coverage':
            from . import coverage
            from .paths import load_search_config
            search = load_search_config()
            places = search.get('locations') or {}
            said = coverage.verdict(coverage.load(), search.get('role_keywords') or [],
                                    [fragment for group in places.values() for fragment in group], search.get('title_exclude_keywords') or [])
            if said is not None:
                said['languages'] = coverage.language_drops()
                said['visits'] = _visits(search)
            print(json.dumps(said, ensure_ascii=False))
            return 0
        if args.command == 'role-ideas':
            from . import coverage, features
            from .ai import engine, role_ideas
            from .paths import load_search_config, local_profile
            asked = json.loads(Path(args.file).read_text()) if args.file else {}
            if features.disabled('role_ideas') or not engine.ready():
                print(json.dumps({'ok': True, 'ideas': []}))
                return 0
            try:
                profile = local_profile()
                if not profile:
                    from .notion.client import Tracker
                    tracker = Tracker.from_env()
                    profile = tracker.page_text() if tracker else ''
                found = role_ideas.ideas(profile or '', load_search_config(), (coverage.load() or {}).get('missed_titles') or [], asked.get('set_aside') or [])
            except Exception as error:  # noqa: BLE001 — no ideas this time, said; the box shows the market's words as before
                print(json.dumps({'ok': False, 'ideas': [], 'error': f'No role ideas this time ({type(error).__name__})'}))
                return 0
            print(json.dumps({'ok': True, 'ideas': found}, ensure_ascii=False))
            return 0
        if args.command == 'visit-outcome':
            from .sources import visits
            visits.outcome(json.loads(Path(args.file).read_text()))
            print(json.dumps({'ok': True}))
            return 0
        if args.command == 'visit-hide':
            from .sources import visits
            visits.hide(args.url)
            print(json.dumps({'ok': True}))
            return 0
        if args.command == 'visit-list':
            from .paths import load_search_config
            print(json.dumps({'ok': True, 'visits': _visits(load_search_config(matching=False))}, ensure_ascii=False))
            return 0
        if args.command == 'visit-context':
            from .notion.search_settings import terms
            from .paths import load_search_config
            search = load_search_config(matching=False)
            places = search.get('locations') or {}
            print(json.dumps({'role_words': terms(search.get('role_keywords'))[:10], 'places_first': terms(places.get('top_tier'))[:6],
                              'places_also': terms((places.get('country_wide') or []) + (places.get('abroad') or []))[:6],
                              'title_words_ruled_out': terms(search.get('title_exclude_keywords'))[:12]}, ensure_ascii=False))
            return 0
        if args.command == 'visit-unblock':
            from .ai import visit_unblock
            from .paths import load_search_config
            from .digest import PREFERENCES
            page = json.loads(Path(args.file).read_text())
            try:
                planned = visit_unblock.plan_twice(page, load_search_config(matching=False), PREFERENCES)
            except Exception as error:  # noqa: BLE001 — said to the extension, which stops the site with this reason
                print(json.dumps({'ok': False, 'error': f'Claude could not find a way to the jobs ({type(error).__name__})'}))
                return 0
            print(f"Visit unblock: {len(planned['steps'])} steps for {str(page.get('url') or '')[:80]}: "
                  + '; '.join(f"{s['action']} {s['label'][:40]}{' = ' + s['value'] if s['value'] else ''}" for s in planned['steps'])
                  + (f" (needs you: {planned['needs_person']})" if planned['needs_person'] else '')
                  + (' (Sonnet, after Haiku found no way)' if planned.get('model') == visit_unblock.SECOND_MODEL else ''), file=sys.stderr)
            print(json.dumps({'ok': True, **planned}, ensure_ascii=False))
            return 0
        if args.command == 'visit-filters':
            from .ai import visit_filters
            from .paths import load_search_config
            from .digest import PREFERENCES
            page = json.loads(Path(args.file).read_text())
            try:
                planned = visit_filters.plan(page, load_search_config(matching=False), PREFERENCES)
            except Exception as error:  # noqa: BLE001 — said to the extension, which then reads the page as it is
                print(json.dumps({'ok': False, 'error': f'Claude could not choose the filters ({type(error).__name__})'}))
                return 0
            print(f"Visit filters: {len(planned['steps'])} steps for {str(page.get('url') or '')[:80]}: "
                  + '; '.join(f"{s['action']} {s['label'][:40]}{' = ' + s['value'] if s['value'] else ''}" for s in planned['steps']), file=sys.stderr)
            print(json.dumps({'ok': True, **planned}, ensure_ascii=False))
            return 0
        if args.command in ('visit-understand', 'visit-recipe'):
            from .sources import visits
            page = json.loads(Path(args.file).read_text())
            if args.command == 'visit-recipe':
                if page.get('forget'):
                    visits.forget_recipe(page['url'])
                forgot = bool(page.get('missed')) and visits.recipe_missed(page['url'])
                print(json.dumps({'ok': True, 'forgot': forgot, 'recipe': None if page.get('forget') or forgot else visits.recipe_for(page['url'])}))
                return 0
            from .ai import visit_reader
            try:
                recipe, model = visit_reader.understand_twice(page)
                if model == visit_reader.SECOND_MODEL:   # said, so the log shows whether the second try pays off
                    print(f"Visit: Haiku found no job list on {str(page.get('url') or '')[:80]}; Sonnet did", file=sys.stderr)
                elif not recipe and page.get('groups'):
                    print(f"Visit: no job list on {str(page.get('url') or '')[:80]}, by Haiku nor Sonnet", file=sys.stderr)
            except Exception as error:  # noqa: BLE001 — said; the extension reads what its quick guess found
                print(json.dumps({'ok': False, 'error': f'Claude could not read this page ({type(error).__name__})'}))
                return 0
            if recipe:
                visits.save_recipe(page['url'], recipe)
            print(json.dumps({'ok': True, 'recipe': recipe}, ensure_ascii=False))
            return 0
        if args.command == 'visit-session':
            from .sources import visits
            print(json.dumps({'ok': True, 'result': visits.session_result(args.session)}, ensure_ascii=False))
            return 0
        if args.command == 'visit-jobpages':
            from .sources import visits
            from . import employer_index
            sites = json.loads(Path(args.file).read_text())
            print(json.dumps({'ok': True, 'pages': visits.find_job_pages(sites, employer_index.me_now().get('countries') or [])}))
            return 0
        if args.command == 'visit-jobpage':
            from .sources import visits
            page = json.loads(Path(args.file).read_text())
            print(json.dumps({'ok': True, 'url': visits.job_page(page['url'], page.get('html') or '')}))
            return 0
        if args.command == 'visit-read':
            from .sources import visits
            page = json.loads(Path(args.file).read_text())
            result = visits.read(page['url'], page.get('html') or '', page.get('cards'), page.get('title') or '', session=page.get('session') or '',
                                 start=page.get('start') or '')
            with store.connect(JOBS_DB) as db:   # the page becomes one of this user's feeds: the next jobs check reads, filters and scores it
                from . import scout
                db.executescript(scout.TABLES)
                db.execute("""INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES ('visit', ?, ?, 'Standard', NULL, ?)""",
                           (result['feed'], result['name'], datetime.now(timezone.utc).isoformat(timespec='seconds')))
                # A page that is a job system the engine reads by itself (Chanel's Workday, 7 Oct 2026): a feed like any other from now on, read
                # whole with each job's place at every search, no browser needed.
                from .sources import ats
                system = ats.detect(page['url'])
                if system and system[0] in ats.FETCHERS and system[0] not in ('careers', 'visit'):
                    company = (page.get('site') or result['name'])[:120]
                    added = db.execute("""INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES (?, ?, ?, 'Standard', NULL, ?)""",
                                       (system[0], system[1], company, datetime.now(timezone.utc).isoformat(timespec='seconds'))).rowcount
                    if added:
                        print(f'Visit: {company} runs on {system[0]} ({system[1]}): read by every search from now on, no browser needed', file=sys.stderr)
                db.commit()
            print(json.dumps({'ok': True, 'name': result['name'], 'jobs': len(result['jobs']), 'added': result['added'], 'fits': result['fits'], 'kind': result['kind'],
                              'in_places': result.get('in_places', 0), 'placed': result.get('placed', 0)}, ensure_ascii=False))
            return 0
        from .notion.client import Tracker
        tracker = Tracker.from_env()
        if args.command == 'unapply':
            if not tracker:
                print(json.dumps({'ok': False, 'error': 'Notion is not connected.'}))
                return 0
            try:
                outcome = tracker.revert_applying(args.url)
            except Exception as error:  # noqa: BLE001 — shown to the user; nothing changed
                print(json.dumps({'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing changed. Try again.'}))
                return 0
            print(json.dumps({'ok': True, 'notion': outcome}))
        if args.command == 'not-submitted':
            # The owner says an Applied was wrong. Only a bare Applied is undone, and its false 📈 event goes with
            # it, so the application's timeline does not keep a submission that never happened (1 Oct 2026).
            if not tracker:
                print(json.dumps({'ok': False, 'error': 'Notion is not connected.'}))
                return 0
            from .notion.ledger import archive_events
            try:
                outcome, page = tracker.revert_unsubmitted(args.url)
                dropped = archive_events(tracker, page, 'Applied') if outcome == 'updated' and page else 0
            except Exception as error:  # noqa: BLE001 — shown to the user; nothing changed
                print(json.dumps({'ok': False, 'error': f'Notion could not be updated ({type(error).__name__}); nothing changed. Try again.'}))
                return 0
            errors = {'unchanged': 'That job is not at Applied, so there is nothing to undo.',
                      'past': 'That job is past Applied (a confirmation or an interview is recorded), so its stage is not changed here.'}
            print(json.dumps({'ok': outcome == 'updated', 'notion': outcome, 'events': dropped,
                              **({} if outcome == 'updated' else {'error': errors[outcome]})}))
            return 0
        if args.command == 'calendar':
            print(json.dumps(calendar_jobs(tracker), ensure_ascii=False))
            return 0
        if args.command == 'rescore-previous':
            print(json.dumps({'queued': score.rescore_previous(db)}))
            return 0
        if args.command == 'tune':
            if not tracker:
                print(json.dumps({'ok': False, 'error': 'Connect Notion first: your outcomes (dismissed, applied, interviews) live there.'}))
                return 0
            from . import tune
            from .paths import load_search_config
            print(json.dumps(tune.run(db, tracker, load_search_config()), ensure_ascii=False))
            return 0
        if args.command == 'strategy':
            print(json.dumps(strategy(db, tracker), ensure_ascii=False))
            return 0
        if args.command == 'jobs':
            found = None
            if tracker:
                try:
                    found = tracker.notion_jobs()  # the list, from Notion
                except Exception as error:  # the list still shows from the cache, marked as possibly out of date
                    print(f'Warning: Notion unavailable, showing the cached list: {type(error).__name__}: {error}',
                          file=__import__('sys').stderr)
            current = None  # the inputs a kit would be drafted from now: to tell current kits from earlier ones
            if found and any(_kit(job.get('stage'), job.get('next_step') or '') for job in found):
                try:
                    from .ai import kit
                    current = provenance.kit_inputs(tracker.page_text(), kit.standard_answers(tracker))
                except Exception:  # noqa: BLE001 — kits then show as "inputs unknown"
                    pass
            from .ai import engine as ai_engine
            result = jobs(db, args.limit, notion_jobs=found, kit_inputs=current, hide_unscored=ai_engine.ready())
            fresh = found is not None
            if tracker and not fresh:
                result['stale'] = True
        elif args.command == 'delete':
            result = delete_job(db, args.url, tracker)
        else:
            result = set_status(db, args.url, args.status, tracker)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
