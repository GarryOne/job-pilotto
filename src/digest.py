"""Telegram digest: filtering, ranking, rotation, paging and message layout."""
from datetime import datetime, timedelta, timezone
from html import escape, unescape
import json
import os
import random
import re

from . import store
from .ai import enrich, score
from .notion import client as notion
from .paths import CONFIG, keyword_regex, load_search_config

WORK_MODE_BADGES = {'Hybrid': '🔀 Hybrid', 'Remote (stated)': '🌍 Remote', 'Remote mentioned': '🌍 Remote?'}
TELEGRAM_LIMIT = 4096
# Leave room for the footer and "part 2/3" suffix.
CHUNK_LIMIT = TELEGRAM_LIMIT - 200
PAGE_SIZE = 10  # Jobs per digest message; '➕ Next' loads the following page.
_SEARCH = load_search_config()
HOME = keyword_regex([*_SEARCH['locations']['top_tier'], *_SEARCH['locations']['country_wide']])
RELEVANT = keyword_regex(_SEARCH['role_keywords'])
PREFERENCES = json.loads((CONFIG / 'preferences.json').read_text())
MIN_DIGEST_SCORE = PREFERENCES.get('digest_min_score', 50)
# The tool's own name is "Job Pilotto" (generic, any fork); this is your own digest's display name.
# `or`: a workflow passes an unset repository variable as '' ("✈️ · 🆕 173 new" on GitHub, 29 Sep 2026).
BRAND_NAME = os.getenv('DIGEST_BRAND_NAME') or 'Job Pilotto'
LANGUAGE_FLAGS = {'German': '🇩🇪', 'French': '🇫🇷', 'Italian': '🇮🇹', 'Spanish': '🇪🇸', 'Portuguese': '🇵🇹', 'Dutch': '🇳🇱', 'English': '🇬🇧', 'Other': '🌐'}
SENIORITY_LABELS = {'junior': 'Junior', 'mid': 'Mid', 'senior': 'Senior', 'staff_principal': 'Staff/Principal',
                    'lead_manager': 'Lead/Manager'}


def visible_length(html_text):
    """Length Telegram counts against its limit: text without tags, entities decoded."""
    return len(unescape(re.sub(r'<[^>]+>', '', html_text)))


def _work_mode_badge(value):
    for prefix, badge in WORK_MODE_BADGES.items():
        if (value or '').startswith(prefix):
            return badge
    return None


def in_places(job):
    """True when the job is in one of your places (config/search.json: best places, anywhere in the country)."""
    return bool(job.get('city')) or bool(HOME.search(job.get('location') or ''))


BEST_PLACES = keyword_regex(_SEARCH['locations']['top_tier'])
PREFERRED_ABROAD = keyword_regex(_SEARCH['locations']['abroad'])
# Where the user may work without a visa beyond their own places (citizenship / work rights): ⚙️ Search settings → "Where you
# can work without a visa", e.g. "EU" for an EU citizen. "EU" stands for every EU member state.
EU_PLACES = ['austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece',
             'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland', 'portugal', 'romania',
             'slovakia', 'slovenia', 'spain', 'sweden', 'berlin', 'munich', 'hamburg', 'frankfurt', 'amsterdam', 'paris', 'dublin',
             'madrid', 'barcelona', 'lisbon', 'vienna', 'brussels', 'copenhagen', 'stockholm', 'warsaw', 'prague', 'milan', 'rome']
_EU_FRAGMENT = re.compile(r'(?:\\b)?(?:eu|european\\ union|european union)(?:\\b)?', re.I)


def work_rights_regex(fragments):
    """Regex for the places the user may work without sponsorship (None when none are given)."""
    parts = []
    for fragment in fragments or []:
        parts += [rf'\b{place}\b' for place in EU_PLACES] if _EU_FRAGMENT.fullmatch(fragment) else [fragment]
    return keyword_regex(parts) if parts else None


WORK_RIGHTS = work_rights_regex(PREFERENCES.get('work_rights'))


def needs_sponsorship(job):
    """True when the job is in one of your places abroad and your citizenship / work rights do not cover it, so you would need a
    visa. Your own places never do; with no work rights set, every place abroad does."""
    if in_places(job):
        return False
    where = f"{job.get('location') or ''} {job.get('city') or ''}"
    if WORK_RIGHTS and WORK_RIGHTS.search(where):
        return False
    return bool(PREFERRED_ABROAD.search(where))


def location_points(job):
    """Your top-tier place (config/search.json) most preferred; country-wide, listed abroad or remote fine."""
    where = f"{job.get('location') or ''} {job.get('city') or ''}"
    remote = ((job.get('ai') or {}).get('work_mode', {}).get('value') == 'remote'
              or (job.get('work_mode') or '').startswith('Remote'))
    if BEST_PLACES.search(where):
        return 5
    if in_places(job):
        return 4
    if PREFERRED_ABROAD.search(where) or remote:
        return 3
    return 0


def rank_score(job):
    """Higher is better: preferred location first, then role_keywords titles, then remote."""
    score = location_points(job) + (3 if job.get('saved') else 0)
    if RELEVANT.search(job.get('title') or ''):
        score += 2
    if (job.get('work_mode') or '').startswith(('Remote', 'Hybrid')):
        score += 1
    ai = job.get('ai')
    if ai:
        if ai['english_is_enough']['value'] == 'yes':
            score += 1
        if any(l['level'] == 'nice_to_have' and l['language'] in PREFERENCES['disqualifying_languages']
               for l in ai['languages']):
            score -= 1
        if ai['employer_type']['value'] == 'recruiter':
            score -= 1
        if ai['seniority']['value'] == 'junior':
            score -= 3
    return score


def language_blocked(job):
    """True when AI extraction found a required language the profile can't meet."""
    ai = job.get('ai')
    return bool(ai) and any(l['level'] == 'required' and l['language'] in PREFERENCES['disqualifying_languages']
                            for l in ai['languages'])


LEGAL_SUFFIXES = {'sa', 'ag', 'gmbh', 'sarl', 'sàrl', 'inc', 'ltd', 'llc', 'plc', 'bv', 'nv', 'ab', 'oy', 'as', 'spa',
                  'srl', 'sas', 'co', 'corp', 'corporation', 'limited', 'company', 'se', 'kg', 'ug'}


def company_key(name):
    """A company name without case, punctuation or legal form: "AcmeSource SA" -> "acmesource"."""
    words = re.sub(r'[^\w]+', ' ', (name or '').casefold().replace('.', '')).split()
    while len(words) > 1 and words[-1] in LEGAL_SUFFIXES:
        words.pop()
    return ' '.join(words)


def company_excluded(job):
    """True when the job's company is on config/preferences.json's excluded_companies list (the same company
    whatever its legal form: "AcmeSource SA" is "AcmeSource")."""
    company = company_key(job.get('company'))
    return bool(company) and any(company == company_key(name) for name in PREFERENCES.get('excluded_companies', []))


def hard_filtered(job):
    return language_blocked(job) or company_excluded(job)


_CUR = r"(?:CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|BRL|CAD|AUD|MXN|INR|JPY|R\$|US\$|C\$|A\$|[£$€])"
_NUM = r"\d[\d'’,. ]*\d(?:\s?[kK])?|\d(?:\s?[kK])?"
SALARY_FIGURE = re.compile(rf"(?:{_CUR}\s?)?(?:{_NUM})(?:\s?{_CUR})?(?:\s?(?:-|–|to)\s?(?:{_CUR}\s?)?(?:{_NUM})(?:\s?{_CUR})?)?")


def _salary(text):
    """Just the salary figure or range ('SEK 878,578 - SEK 1,054,294'), or None if there is none.

    Needs a currency or a 'k' so that years, percentages and team sizes don't count."""
    for match in SALARY_FIGURE.finditer(re.sub(r'\s+', ' ', text or '')):
        figure = match.group(0).strip(" ,.;-–")
        if re.search(_CUR, figure) or re.search(r'\d\s?[kK]\b', figure):
            return figure if len(figure) <= 40 else figure[:39] + '…'
    return None


def _ai_badges(ai, job=None):
    """Signals worth an emoji; everything else stays plain text."""
    badges = []
    if ai['english_is_enough']['value'] == 'yes':
        badges.append('🇬🇧 English')
    for lang in ai['languages']:
        if lang['language'] == 'Other':
            if lang['level'] == 'required':
                badges.append('⚠️ other language required')
        elif lang['language'] != 'English':
            suffix = ' required' if lang['level'] == 'required' else ' +'
            badges.append(f"{LANGUAGE_FLAGS[lang['language']]} {lang['language']}{suffix}")
    salary = _salary(ai['salary']['text']) if ai['salary']['stated'] else None
    if salary:
        badges.append(f"💰 {escape(salary)}")
    elif ai['salary']['stated']:
        badges.append('💰 salary info')
    if ai['employer_type']['value'] == 'recruiter':
        badges.append('👤 Recruiter')
    sponsorship = ai.get('visa_sponsorship', {}).get('value')
    if sponsorship == 'offered':
        badges.append('🛂 sponsorship offered')
    elif sponsorship == 'not_offered' or (job and needs_sponsorship(job)):
        badges.append('🔴 visa sponsorship needed')
    return badges


def rank_jobs(jobs, rng):
    """Sort by score; shuffle first so equally scored jobs rotate between digests."""
    jobs = list(jobs)
    rng.shuffle(jobs)
    return sorted(jobs, key=rank_score, reverse=True)


LEGAL_SUFFIX = re.compile(r"[\s,]+(AG|SA|S\.A\.|GmbH|Sàrl|S\.à\s?r\.l\.|Ltd\.?|Limited|Inc\.?|LLC|plc|SE|Co\.)$", re.I)
GENDER_TAG = re.compile(r"\s*\((?:[mwfdxa]\s*[/|,]?\s*)+\)|\s*\((?:all genders?|alle|tous genres)\)", re.I)
INDENT = '   '


def short_company(name):
    """'Zürich Versicherungs-Gesellschaft AG / Zurich Insurance Company Ltd' -> 'Zürich Versicherungs-Gesellschaft'."""
    name = re.split(r'\s+/\s+|\s+\|\s+', (name or '').strip())[0]
    while LEGAL_SUFFIX.search(name):
        name = LEGAL_SUFFIX.sub('', name)
    return name or 'Unknown employer'


def short_title(title):
    """Drop gender tags such as (m/f/d), (a), (all genders); keep everything else."""
    return re.sub(r'\s{2,}', ' ', GENDER_TAG.sub('', title or '')).strip(' -–|') or title


MODE_LABELS = {'onsite': '🏢 On-site', 'hybrid': '🏠 Hybrid', 'remote': '🌍 Remote'}


def _job_block(index, job):
    """Layout: bold linked title / company · location · seniority · work mode / signals."""
    title = f"<b>{escape(short_title(job['title']))}</b>"
    if job.get('url'):
        title = f'<a href="{escape(job["url"], quote=True)}">{title}</a>'
    facts = [escape(short_company(job['company'])), escape(job.get('location') or 'location not stated')]
    ai = job.get('ai')
    if ai and ai['seniority']['value'] in SENIORITY_LABELS:
        facts.append(f"<b>{SENIORITY_LABELS[ai['seniority']['value']]}</b>")
    mode = MODE_LABELS.get(ai['work_mode']['value'] if ai else '')
    if not mode:
        badge = _work_mode_badge(job.get('work_mode'))
        mode = {'🔀 Hybrid': '🏠 Hybrid'}.get(badge, badge)
    if mode:
        facts.append(mode)
    fit = job.get('fit')
    star = '⭐ ' if job.get('saved') else ''
    head = f"{index}. {star}{title}" + (f" · <b>{fit['score']}/100</b>" if fit else '')
    lines = [head, INDENT + ' · '.join(facts)]
    # The visa flag is a rule on your places and work rights, not an AI finding: it shows without AI facts too.
    signals = _ai_badges(ai, job) if ai else (['🔴 visa sponsorship needed'] if needs_sponsorship(job) else [])
    if signals:
        lines.append(INDENT + ' · '.join(signals))
    if fit and fit.get('reason'):
        lines.append(f"{INDENT}<i>{escape(fit['reason'][:110])}</i>")
    return '\n'.join(lines)


def _keyboard(entries):
    """Number buttons, five per row. Tapping n makes the Worker show '✅ Applied · ⭐ Save · ❌ Dismiss'
    for job n on the same message (callback 'pick:<code>:<n>')."""
    buttons = [{'text': str(index), 'callback_data': f'pick:{code}:{index}'} for index, code in entries]
    return {'inline_keyboard': [buttons[i:i + 5] for i in range(0, len(buttons), 5)]} if buttons else None


SHOWN_TABLE = """
CREATE TABLE IF NOT EXISTS shown (
    job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
    last_shown_at TEXT NOT NULL,
    last_seed INTEGER NOT NULL,
    times INTEGER NOT NULL DEFAULT 1
);
"""
ROTATION_HOURS = 24


def recently_shown(db, seed, now=None):
    """Job ids sent in a digest within ROTATION_HOURS, except by this digest's own seed,
    so its later pages keep the order its first page was built with."""
    db.executescript(SHOWN_TABLE)
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=ROTATION_HOURS)).isoformat(timespec='seconds')
    return {row['job_id'] for row in db.execute(
        'SELECT job_id FROM shown WHERE last_shown_at >= ? AND last_seed != ?', (cutoff, seed))}


def mark_shown(db, job_ids, seed, now=None):
    db.executescript(SHOWN_TABLE)
    stamp = (now or datetime.now(timezone.utc)).isoformat(timespec='seconds')
    db.executemany("""INSERT INTO shown (job_id, last_shown_at, last_seed) VALUES (?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET last_shown_at=excluded.last_shown_at,
        last_seed=excluded.last_seed, times=shown.times + 1""", [(i, stamp, seed) for i in job_ids])
    db.commit()


BEST_MATCH_SCORE = 70   # Older jobs at or above this fit score are grouped as best matches.
UNSCORED_SCORE = 45     # Where unscored jobs sit among scored ones.
ROTATION_PENALTY = 15   # Points a job loses if it was shown in the last ROTATION_HOURS.
ROTATION_JITTER = 8     # Random points added per digest, so near-equal matches take turns.
SAVED_BONUS = 10        # Saved (⭐) jobs rank higher until applied or dismissed.


def eligible_jobs(db, hidden_urls=frozenset()):
    """Open jobs the owner could apply to, with stage 1 facts attached; also returns the
    hard-filtered ones (required disqualifying language, or an excluded company). Applied jobs
    (hidden_urls) are excluded from both."""
    facts = enrich.load(db)
    jobs = [dict(j, ai=facts.get(j['id'])) for j in store.digest_jobs(db, limit=10_000, only_new=False)
            if (j.get('url') or '').strip() not in hidden_urls]
    return [j for j in jobs if not hard_filtered(j)], [j for j in jobs if hard_filtered(j)]


def build_digest(db, limit=50, rng=None, hidden_urls=frozenset(), page=1, seed=None, shown_ids=None,
                 saved_urls=frozenset()):
    """Return (messages, new_count, keyboards) for one page of the digest.

    All eligible jobs are ranked once (new first, then "more to explore", shuffled
    within each score using `seed`, so page 2 continues page 1's order). A page
    shows PAGE_SIZE jobs in one message, with '✅ n' buttons and, when more jobs
    remain, a '➕ Next' button that asks for page+1 with the same seed.

    Rotation: among older jobs, those sent in the last ROTATION_HOURS go after the
    ones not seen yet, so consecutive digests don't open with the same ten.
    The ids of the jobs on this page are appended to shown_ids when given.
    """
    seed = seed if seed is not None else random.randrange(1, 10**9)
    rng = rng or random.Random(seed)
    everything, blocked = eligible_jobs(db, hidden_urls)
    fits = score.load(db)
    for job in everything:
        job['fit'] = fits.get(job['id'])
        job['saved'] = (job.get('url') or '').strip() in saved_urls
    # Scored jobs below digest_min_score stay in Notion Job Matches but don't use digest space;
    # saved ones always show, and unscored ones are shown so the digest still works without AI.
    low_fit = {j['id'] for j in everything if j['fit'] and j['fit']['score'] < MIN_DIGEST_SCORE and not j['saved']}
    everything = [j for j in everything if j['id'] not in low_fit]
    new_ids = {job['id'] for job in store.digest_jobs(db, limit=10_000, only_new=True)}
    recent = recently_shown(db, seed)
    new = rank_jobs([j for j in everything if j['id'] in new_ids], rng)
    new.sort(key=lambda j: -(j['fit'] or {}).get('score', -1))  # stable: unscored keep rule order
    older = rank_jobs([j for j in everything if j['id'] not in new_ids], rng)
    if any(j['fit'] for j in older):
        # Best matches lead every digest, with light rotation: a match shown in the last
        # 24 h loses ROTATION_PENALTY points and every score gets a little random jitter.
        def effective(job):
            base = (job['fit']['score'] if job['fit'] else UNSCORED_SCORE) + (SAVED_BONUS if job.get('saved') else 0)
            return base - (ROTATION_PENALTY if job['id'] in recent else 0) + rng.uniform(0, ROTATION_JITTER)
        older.sort(key=effective, reverse=True)
    else:
        # Stable sort: unseen first, each group keeping its score order.
        older.sort(key=lambda j: j['id'] in recent)
    ranked = [('new', j) for j in new]
    # Each section once: all best matches (in their rotated order), then the rest. Rotation alone could
    # put a 56 between two 80s and repeat the "Best matches" heading.
    is_best = lambda j: (j['fit'] or {}).get('score', 0) >= BEST_MATCH_SCORE
    ranked += [('best', j) for j in older if is_best(j)] + [('older', j) for j in older if not is_best(j)]
    ranked = ranked[:limit]
    first = (page - 1) * PAGE_SIZE
    shown = ranked[first:first + PAGE_SIZE]

    if page == 1:
        places_total = sum(in_places(j) for j in everything)
        stats = [f"{len(everything)} open", f"{places_total} pinned"]
        if hidden_urls:
            stats.append(f"{len(hidden_urls)} applied")
        pipeline = [' · '.join(stats)]
        rest = [f"{len(blocked)} filtered"] if blocked else []
        if low_fit:
            rest.append(f"{len(low_fit)} low fit")
        if rest:
            pipeline.append(' · '.join(rest))
        pipeline_block = '<b>Your pipeline</b>\n' + '\n'.join(pipeline)
        header = (f"✈️ <b>{BRAND_NAME}</b> · Job digest\n"
                  f"{len(new)} new · Top {len(shown)} of {len(ranked)} ranked jobs")
    elif shown:
        header = f"✈️ <b>{BRAND_NAME}</b> · jobs {first + 1}–{first + len(shown)} of {len(ranked)}"
    else:
        return [f'✈️ <b>{BRAND_NAME}</b> · no more jobs in this list. Send /today for a fresh one.'], len(new), [None]

    SECTION_LABELS = {'new': 'New since your last run', 'best': 'Best matches', 'older': 'More to explore'}
    group_sizes = {}
    for kind, job in shown:
        key = (kind, in_places(job))
        group_sizes[key] = group_sizes.get(key, 0) + 1
    blocks, entries, section = [header], [], None
    for offset, (kind, job) in enumerate(shown):
        index = first + offset + 1
        # One heading per run of jobs: where they are (your places or elsewhere), then why they are listed.
        key = (kind, in_places(job))
        if key != section:
            section = key
            place = '📍 <b>In your preferred locations</b>' if key[1] else '🌍 <b>Outside your preferred locations</b>'
            count = group_sizes[key]
            blocks.append(f"{place}\n{SECTION_LABELS[kind]} · {count} {'job' if count == 1 else 'jobs'}")
        blocks.append(_job_block(index, job))
        if shown_ids is not None:
            shown_ids.append(job['id'])
        if job.get('url'):
            entries.append((index, notion.job_code(job['url'])))
    remaining = len(ranked) - (first + len(shown))
    if page == 1:
        blocks.append(pipeline_block)
    blocks.append('<i>Tap a job number to mark it applied, save or dismiss it.</i>'
                  + (f' <i>{remaining} more with ➕.</i>' if remaining else ''))
    text = '\n\n'.join(blocks)
    keyboard = _keyboard(entries)
    if remaining:
        keyboard = keyboard or {'inline_keyboard': []}
        keyboard['inline_keyboard'].append(
            [{'text': f'➕ Next {min(PAGE_SIZE, remaining)}', 'callback_data': f'more:{seed}:{page + 1}'}])
    return [text], len(new), [keyboard]


def format_digest(db, limit=50, rng=None, hidden_urls=frozenset(), page=1, seed=None, saved_urls=frozenset()):
    return '\n\n'.join(build_digest(db, limit, rng, hidden_urls, page, seed, saved_urls=saved_urls)[0])
