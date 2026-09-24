#!/usr/bin/env python3
"""Run the local scan, import canonical state and optionally send Telegram digest."""
import argparse
from datetime import datetime, timedelta, timezone
from html import escape, unescape
import json
import os
from pathlib import Path
import random
import re
import subprocess
import urllib.parse
import urllib.request

import applications
import enrich
import score
import scout
import job_store
import matches
import watch

ROOT = Path(__file__).resolve().parent

WORK_MODE_BADGES = {'Hybrid': '🔀 Hybrid', 'Remote (stated)': '🌍 Remote', 'Remote mentioned': '🌍 Remote?'}
TELEGRAM_LIMIT = 4096
# Leave room for the footer and "part 2/3" suffix.
CHUNK_LIMIT = TELEGRAM_LIMIT - 200
STALE_DAYS = 7  # A job not seen by a full crawl for this long is closed (reopened if seen again).
PAGE_SIZE = 10  # Jobs per digest message; '➕ Next' loads the following page.
SWISS = re.compile(r"switzerland|schweiz|suisse|svizzera|zurich|zürich|geneva|genève|genf|basel|bern|"
                   r"lausanne|lugano|luzern|lucerne|winterthur|zug|st\.? gallen", re.I)
RELEVANT = re.compile(r"site reliability|\bsre\b|platform|devops|infrastructure|cloud|kubernetes|"
                      r"production engineer|observability", re.I)
MODES = ('scheduled', 'run', 'today', 'apply', 'more')
PREFERENCES = json.loads((ROOT / 'preferences.json').read_text())
LANGUAGE_FLAGS = {'German': '🇩🇪', 'French': '🇫🇷', 'Italian': '🇮🇹', 'English': '🇬🇧', 'Other': '🌐'}
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


def is_swiss(job):
    return bool(job.get('city')) or bool(SWISS.search(job.get('location') or ''))


ZURICH_AREA = re.compile(r"z[uü]rich|winterthur|\bzug\b|baden|uster|d[uü]bendorf|oerlikon|kloten|glattbrugg|"
                         r"opfikon|wallisellen|schlieren|dietikon|r[uü]schlikon|thalwil|horgen|b[uü]lach", re.I)
PREFERRED_ABROAD = re.compile(r"berlin|london|dubai", re.I)


def location_points(job):
    """Profile: Zurich area most preferred; anywhere in Switzerland, Berlin, London, Dubai or remote fine."""
    where = f"{job.get('location') or ''} {job.get('city') or ''}"
    remote = ((job.get('ai') or {}).get('work_mode', {}).get('value') == 'remote'
              or (job.get('work_mode') or '').startswith('Remote'))
    if ZURICH_AREA.search(where):
        return 5
    if is_swiss(job):
        return 4
    if PREFERRED_ABROAD.search(where) or remote:
        return 3
    return 0


def rank_score(job):
    """Higher is better: preferred location first, then SRE-type titles, then remote."""
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


_CUR = r"(?:CHF|EUR|USD|GBP|SEK|NOK|DKK|PLN|[£$€])"
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


def _ai_badges(ai):
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
    head = f"{index}. {star}{title}" + (f" · 🎯 <b>{fit['score']}</b>" if fit else '')
    lines = [head, INDENT + ' · '.join(facts)]
    signals = _ai_badges(ai) if ai else []
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
    language-blocked ones. Applied jobs (hidden_urls) are excluded from both."""
    facts = enrich.load(db)
    jobs = [dict(j, ai=facts.get(j['id'])) for j in job_store.digest_jobs(db, limit=10_000, only_new=False)
            if (j.get('url') or '').strip() not in hidden_urls]
    return [j for j in jobs if not language_blocked(j)], [j for j in jobs if language_blocked(j)]


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
    new_ids = {job['id'] for job in job_store.digest_jobs(db, limit=10_000, only_new=True)}
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
    ranked += [('best' if (j['fit'] or {}).get('score', 0) >= BEST_MATCH_SCORE else 'older', j) for j in older]
    ranked = ranked[:limit]
    first = (page - 1) * PAGE_SIZE
    shown = ranked[first:first + PAGE_SIZE]

    if page == 1:
        swiss_total = sum(is_swiss(j) for j in everything)
        stats = [f"{len(everything)} open", f"{swiss_total} 🇨🇭"]
        if hidden_urls:
            stats.append(f"{len(hidden_urls)} applied")
        if blocked:
            stats.append(f"{len(blocked)} language-filtered")
        header = (f"🇨🇭 <b>SRE Watch</b> · 🆕 {len(new)} new · top {len(shown)} of {len(ranked)}\n"
                  f"<i>{' · '.join(stats)}</i>")
    elif shown:
        header = f"🇨🇭 <b>SRE Watch</b> · jobs {first + 1}–{first + len(shown)} of {len(ranked)}"
    else:
        return ['🇨🇭 <b>SRE Watch</b> · no more jobs in this list. Send /today for a fresh one.'], len(new), [None]

    blocks, entries, section, abroad_heading = [header], [], None, False
    for offset, (kind, job) in enumerate(shown):
        index = first + offset + 1
        if kind != section:
            section, abroad_heading = kind, False
            blocks.append({'new': '🆕 <b>New since last run</b>', 'best': '🎯 <b>Best matches</b>',
                           'older': '🎲 <b>More to explore</b>'}[kind])
        # Ranking puts Swiss jobs first; mark where the rest begins instead of flagging every job.
        if not is_swiss(job) and not abroad_heading:
            blocks.append('🌍 <i>Outside Switzerland</i>')
            abroad_heading = True
        blocks.append(_job_block(index, job))
        if shown_ids is not None:
            shown_ids.append(job['id'])
        if job.get('url'):
            entries.append((index, applications.job_code(job['url'])))
    remaining = len(ranked) - (first + len(shown))
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


def find_job(db, code):
    for job in job_store.digest_jobs(db, limit=10_000, only_new=False):
        if job.get('url') and applications.job_code(job['url']) == code:
            return job
    return None


ACTIONS = {'applied': 'Applied', 'saved': 'Saved', 'dismissed': 'Dismissed'}


def apply_message(db, code, tracker, action='applied'):
    """Record a Telegram button action for the job with this code in Notion; return the reply text."""
    job = find_job(db, code)
    if not job:
        return f"⚠️ No job with code <code>{escape(code)}</code>. It may have closed; add it in Notion manually."
    stage = ACTIONS[action]
    page, outcome = tracker.mark(job, stage)
    link = f'<a href="{escape(page.get("url", ""), quote=True)}">Notion</a>'
    title = f"<b>{escape(job['title'])}</b> — {escape(job['company'])}"
    if outcome == 'unchanged':
        return f"ℹ️ Already tracked: {title}\nSee {link}."
    return {
        'Applied': f"✅ Marked applied: {title}\nIt won't appear in digests again. Track the stage in {link}.",
        'Saved': f"⭐ Saved: {title}\nIt stays in digests with a star; /saved lists your saved jobs.",
        'Dismissed': f"❌ Dismissed: {title}\nIt won't appear again, and helps tune the scores.",
    }[stage]


def _telegram_credentials():
    token, chat_id = os.getenv('TELEGRAM_BOT_TOKEN') or keychain_token(), os.getenv('TELEGRAM_CHAT_ID')
    if not token or not chat_id:
        raise SystemExit('--send requires TELEGRAM_CHAT_ID and either TELEGRAM_BOT_TOKEN or the local Keychain entry')
    return token, chat_id


def send_telegram(text, token, chat_id, reply_markup=None):
    endpoint = f"https://api.telegram.org/bot{token}/sendMessage"
    fields = {'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML', 'disable_web_page_preview': 'true'}
    if reply_markup:
        fields['reply_markup'] = json.dumps(reply_markup)
    body = urllib.parse.urlencode(fields).encode()
    request = urllib.request.Request(endpoint, data=body, method='POST')
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
    if not payload.get('ok'):
        raise RuntimeError(payload.get('description', 'Telegram API rejected the message'))
    return payload


def keychain_token():
    """Read the optional local macOS Keychain token without printing it."""
    if os.uname().sysname != 'Darwin':
        return None
    try:
        result = subprocess.run(
            ['security', 'find-generic-password', '-a', os.getenv('USER', ''),
             '-s', 'sre-watch.telegram.bot-token', '-w'],
            check=True, capture_output=True, text=True)
        return result.stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=ROOT / 'data' / 'canonical.sqlite')
    parser.add_argument('--company-report', type=Path, default=ROOT / 'reports' / 'companies.json')
    parser.add_argument('--limit', type=int, default=50, help='jobs in the ranked list, paged 10 at a time')
    parser.add_argument('--page', type=int, default=1)
    parser.add_argument('--seed', type=int, help='ranking seed from a ➕ Next button, so pages continue')
    parser.add_argument('--send', action='store_true', help='send to Telegram; otherwise print preview only')
    parser.add_argument('--mode', choices=MODES, default='scheduled',
                        help='scheduled: send only when new jobs exist; run/today: always send; '
                             'apply: mark --job as applied in Notion')
    parser.add_argument('--job', help='job code from /apply_<code>, for --mode apply')
    parser.add_argument('--action', choices=sorted(ACTIONS), default='applied',
                        help='for --mode apply: applied, saved or dismissed')
    parser.add_argument('--score-max', type=int, default=0,
                        help='AI stage 2: score up to N eligible jobs against the Notion Profile (0 = off)')
    parser.add_argument('--enrich-max', type=int, default=0,
                        help='AI stage 1: extract facts for up to N new/changed jobs after import (0 = off)')
    args = parser.parse_args()
    if not 1 <= args.limit <= 50:
        parser.error('--limit must be between 1 and 50')
    tracker = applications.Tracker.from_env()
    if args.mode == 'apply':
        if not args.job or not tracker:
            raise SystemExit('--mode apply requires --job and NOTION_TOKEN')
        with job_store.connect(args.db) as db:
            reply = apply_message(db, args.job.strip().lower(), tracker, args.action)
        print(reply)
        # Save/Dismiss are already confirmed on the button itself; only Applied gets a message (Notion link).
        if args.send and args.action == 'applied':
            send_telegram(reply, *_telegram_credentials())
        return 0
    hidden, saved, dismissed = frozenset(), frozenset(), frozenset()
    if tracker:
        try:
            stages = tracker.url_stages()
            hidden = frozenset(u for u, st in stages.items() if st not in applications.VISIBLE_STAGES)
            saved = frozenset(u for u, st in stages.items() if st == 'Saved')
            dismissed = frozenset(u for u, st in stages.items() if st == 'Dismissed')
        except Exception as error:  # A Notion outage shouldn't block the digest.
            print(f'Warning: could not read Notion applications: {error}')
    sources = json.loads((ROOT / 'sources.json').read_text())
    report, imported = {'jobs': [], 'sources': []}, []
    with job_store.connect(args.db) as db:
        # A '➕ Next' page reads the stored list as is: importing would mark new jobs
        # as seen and reorder the list between pages.
        if args.mode != 'more':
            # The feed watcher and canonical store intentionally have different schemas.
            # Keep the source-specific history separate, then import the report.
            # sources.json plus every active feed the scout found (local table + Notion Source Registry).
            feeds = scout.active_sources(db, tracker, sources)
            with watch.database(ROOT / 'data' / 'jobs.sqlite') as feed_db:
                report = watch.scan(feeds, feed_db)
            imported = job_store.import_watch_report(db, report)
            if args.mode in ('scheduled', 'run'):
                # Only full crawls can tell that a job disappeared.
                print(f"Closed {job_store.close_stale(db, STALE_DAYS)} job(s) not seen for {STALE_DAYS} days")
        if args.mode != 'more' and args.company_report.exists():
            company_report = json.loads(args.company_report.read_text())
            imported += job_store.import_company_report(db, company_report)
        if args.enrich_max:
            # Runs after import so fresh descriptions are included. AI trouble never blocks the digest.
            try:
                print(enrich.run(db, enrich.DEFAULT_MODEL, args.enrich_max))
            except Exception as error:
                print(f'Warning: enrichment skipped: {type(error).__name__}: {error}')
        if args.score_max and tracker:
            # Scores only jobs that survive the hard filters; the Profile is re-read every run.
            try:
                profile = tracker.page_text()
                candidates, _ = eligible_jobs(db, hidden)
                print(score.run(db, candidates, profile, score.DEFAULT_MODEL, args.score_max))
            except Exception as error:
                print(f'Warning: scoring skipped: {type(error).__name__}: {error}')
        if tracker and args.mode in ('scheduled', 'run', 'today'):
            # Mirror scored jobs into Notion "Job Matches"; a Notion problem never blocks the digest.
            try:
                fits = score.load(db)
                candidates, _ = eligible_jobs(db, hidden)
                scored = [dict(j, fit=fits[j['id']]) for j in candidates if j['id'] in fits]
                open_urls = {j['url'].strip() for j in job_store.digest_jobs(db, limit=10_000) if j.get('url')}
                applied_urls = hidden - dismissed
                print(matches.sync(db, tracker, scored, applied_urls, open_urls, dismissed))
            except Exception as error:
                print(f'Warning: Notion Job Matches sync skipped: {type(error).__name__}: {error}')
        seed = args.seed or random.randrange(1, 10**9)
        shown_ids = []
        messages, new_count, keyboards = build_digest(db, args.limit, hidden_urls=hidden, page=args.page,
                                                      seed=seed, shown_ids=shown_ids, saved_urls=saved)
    text = '\n\n'.join(messages)
    (ROOT / 'reports').mkdir(parents=True, exist_ok=True)
    (ROOT / 'reports' / 'daily-latest.txt').write_text(text + '\n', encoding='utf-8')
    (ROOT / 'reports' / 'daily-latest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(text)
    if not args.send:
        print('\nPreview only. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then rerun with --send.')
        return 0
    token, chat_id = _telegram_credentials()
    if args.mode == 'scheduled' and not new_count:
        print('\nNo new jobs since the last run; nothing sent.')
        return 0
    for message, keyboard in zip(messages, keyboards):
        send_telegram(message, token, chat_id, keyboard)
    if args.mode != 'more':
        # '➕ Next' runs don't save the database, so only first pages count for rotation.
        with job_store.connect(args.db) as db:
            mark_shown(db, shown_ids, seed)
    print(f'\nSent {len(messages)} Telegram message(s); imported {len(imported)} jobs.')


if __name__ == '__main__':
    main()
