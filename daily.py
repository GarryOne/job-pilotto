#!/usr/bin/env python3
"""Run the local scan, import canonical state and optionally send Telegram digest."""
import argparse
from html import escape
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
import job_store
import watch

ROOT = Path(__file__).resolve().parent

WORK_MODE_BADGES = {'Hybrid': '🔀 Hybrid', 'Remote (stated)': '🌍 Remote', 'Remote mentioned': '🌍 Remote?'}
TELEGRAM_LIMIT = 4096
# Leave room for the "part 2/3" suffix Telegram messages get when split.
CHUNK_LIMIT = TELEGRAM_LIMIT - 200
SWISS = re.compile(r"switzerland|schweiz|suisse|svizzera|zurich|zürich|geneva|genève|genf|basel|bern|"
                   r"lausanne|lugano|luzern|lucerne|winterthur|zug|st\.? gallen", re.I)
RELEVANT = re.compile(r"site reliability|\bsre\b|platform|devops|infrastructure|cloud|kubernetes|"
                      r"production engineer|observability", re.I)
MODES = ('scheduled', 'run', 'today', 'apply')
PREFERENCES = json.loads((ROOT / 'preferences.json').read_text())
LANGUAGE_FLAGS = {'German': '🇩🇪', 'French': '🇫🇷', 'Italian': '🇮🇹', 'English': '🇬🇧', 'Other': '🌐'}
SENIORITY_LABELS = {'junior': 'Junior', 'mid': 'Mid', 'senior': 'Senior', 'staff_principal': 'Staff/Principal',
                    'lead_manager': 'Lead/Manager'}


def _work_mode_badge(value):
    for prefix, badge in WORK_MODE_BADGES.items():
        if (value or '').startswith(prefix):
            return badge
    return None


def is_swiss(job):
    return bool(job.get('city')) or bool(SWISS.search(job.get('location') or ''))


def rank_score(job):
    """Higher is better: Swiss location first, then SRE-type titles, then remote."""
    score = 0
    if is_swiss(job):
        score += 4
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


def _salary(text):
    """Short salary text, or None when the posting's wording has no actual figure."""
    text = re.sub(r'\s+', ' ', text or '').strip()
    if not re.search(r'\d', text):
        return None
    return text if len(text) <= 32 else text[:31].rstrip(' ,;-') + '…'


def _ai_badges(ai):
    """Signals worth an emoji; everything else stays plain text."""
    badges = []
    if ai['english_is_enough']['value'] == 'yes':
        badges.append('🇬🇧 English OK')
    for lang in ai['languages']:
        if lang['language'] == 'Other':
            if lang['level'] == 'required':
                badges.append('⚠️ another language required')
        elif lang['language'] != 'English':
            suffix = 'required' if lang['level'] == 'required' else 'a plus'
            badges.append(f"{LANGUAGE_FLAGS[lang['language']]} {lang['language']} {suffix}")
    salary = _salary(ai['salary']['text']) if ai['salary']['stated'] else None
    if salary:
        badges.append(f"💰 {escape(salary)}")
    if ai['employer_type']['value'] == 'recruiter':
        badges.append('🧑‍💼 Recruiter')
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


def _job_block(index, job):
    """Layout: bold linked title; company · location · seniority · work mode; signals; /apply."""
    title = f"<b>{escape(short_title(job['title']))}</b>"
    if job.get('url'):
        title = f'<a href="{escape(job["url"], quote=True)}">{title}</a>'
    facts = [escape(short_company(job['company'])), escape(job.get('location') or 'location not stated')]
    ai = job.get('ai')
    if ai and ai['seniority']['value'] in SENIORITY_LABELS:
        facts.append(SENIORITY_LABELS[ai['seniority']['value']])
    mode = {'onsite': 'On-site', 'hybrid': 'Hybrid', 'remote': 'Remote'}.get(ai['work_mode']['value'] if ai else '')
    if not mode:
        badge = _work_mode_badge(job.get('work_mode'))
        mode = badge.split(' ', 1)[1] if badge else None
    if mode:
        facts.append(mode)
    lines = [f"{index}. {title}", INDENT + ' · '.join(facts)]
    signals = _ai_badges(ai) if ai else []
    if signals:
        # Short signal lists fit on the facts line; longer ones get their own line.
        if len(lines[1]) + len(' · '.join(signals)) <= 70:
            lines[1] += ' · ' + ' · '.join(signals)
        else:
            lines.append(INDENT + ' · '.join(signals))
    if job.get('url'):
        # Telegram turns this into a tappable command in the chat.
        lines.append(f"{INDENT}/apply_{applications.job_code(job['url'])}")
    return '\n'.join(lines)


def build_digest(db, limit=25, rng=None, hidden_urls=frozenset()):
    """Return (messages, new_count) as Telegram HTML; each message fits one Telegram send.

    New jobs come first, ranked. Remaining slots are filled with older open jobs
    ("more to explore"), ranked but shuffled within each score so repeat digests vary.
    Jobs whose URL is in hidden_urls (already applied to) are left out.
    """
    rng = rng or random.Random()
    facts = enrich.load(db)
    everything = [dict(j, ai=facts.get(j['id'])) for j in job_store.digest_jobs(db, limit=10_000, only_new=False)
                  if (j.get('url') or '').strip() not in hidden_urls]
    blocked = [j for j in everything if language_blocked(j)]
    everything = [j for j in everything if not language_blocked(j)]
    new_ids = {job['id'] for job in job_store.digest_jobs(db, limit=10_000, only_new=True)}
    new = rank_jobs([j for j in everything if j['id'] in new_ids], rng)[:limit]
    older = rank_jobs([j for j in everything if j['id'] not in new_ids], rng)[:limit - len(new)]
    swiss_total = sum(is_swiss(j) for j in everything)

    header = (f"🇨🇭 <b>SRE Watch</b> · 🆕 {len(new)} new · 🎲 {len(older)} more to explore\n"
              f"<i>{len(everything)} open jobs tracked, {swiss_total} in Switzerland"
              + (f", {len(hidden_urls)} applied hidden" if hidden_urls else '')
              + (f", {len(blocked)} hidden for required {'/'.join(PREFERENCES['disqualifying_languages'])}"
                 if blocked else '') + "</i>")
    blocks = [header]
    index = 1
    for title, section in (('🆕 <b>New since last run</b>', new), ('🎲 <b>More to explore</b>', older)):
        if not section:
            continue
        blocks.append(title)
        abroad_heading = False
        for job in section:
            # Ranking puts Swiss jobs first; mark where the rest begins instead of flagging every job.
            if not is_swiss(job) and not abroad_heading:
                blocks.append('🌍 <i>Outside Switzerland</i>')
                abroad_heading = True
            blocks.append(_job_block(index, job))
            index += 1

    messages, current = [], ''
    for block in blocks:
        candidate = f"{current}\n\n{block}" if current else block
        if len(candidate) > CHUNK_LIMIT and current:
            messages.append(current)
            current = block
        else:
            current = candidate
    if current:
        messages.append(current)
    if len(messages) > 1:
        messages = [f"{m}\n\n<i>part {i}/{len(messages)}</i>" for i, m in enumerate(messages, 1)]
    return messages, len(new)


def format_digest(db, limit=25, rng=None, hidden_urls=frozenset()):
    return '\n\n'.join(build_digest(db, limit, rng, hidden_urls)[0])


def find_job(db, code):
    for job in job_store.digest_jobs(db, limit=10_000, only_new=False):
        if job.get('url') and applications.job_code(job['url']) == code:
            return job
    return None


def apply_message(db, code, tracker):
    """Mark the job with this /apply_<code> as applied in Notion; return the Telegram reply."""
    job = find_job(db, code)
    if not job:
        return f"⚠️ No job with code <code>{escape(code)}</code>. It may have closed; add it in Notion manually."
    page, created = tracker.mark_applied(job)
    link = f'<a href="{escape(page.get("url", ""), quote=True)}">Notion</a>'
    title = f"<b>{escape(job['title'])}</b> — {escape(job['company'])}"
    if created:
        return f"✅ Marked applied: {title}\nIt won't appear in digests again. Track the stage in {link}."
    return f"ℹ️ Already tracked: {title}\nSee {link}."


def _telegram_credentials():
    token, chat_id = os.getenv('TELEGRAM_BOT_TOKEN') or keychain_token(), os.getenv('TELEGRAM_CHAT_ID')
    if not token or not chat_id:
        raise SystemExit('--send requires TELEGRAM_CHAT_ID and either TELEGRAM_BOT_TOKEN or the local Keychain entry')
    return token, chat_id


def send_telegram(text, token, chat_id):
    endpoint = f"https://api.telegram.org/bot{token}/sendMessage"
    body = urllib.parse.urlencode({'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML',
                                   'disable_web_page_preview': 'true'}).encode()
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
    parser.add_argument('--limit', type=int, default=25)
    parser.add_argument('--send', action='store_true', help='send to Telegram; otherwise print preview only')
    parser.add_argument('--mode', choices=MODES, default='scheduled',
                        help='scheduled: send only when new jobs exist; run/today: always send; '
                             'apply: mark --job as applied in Notion')
    parser.add_argument('--job', help='job code from /apply_<code>, for --mode apply')
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
            reply = apply_message(db, args.job.strip().lower(), tracker)
        print(reply)
        if args.send:
            send_telegram(reply, *_telegram_credentials())
        return 0
    hidden = frozenset()
    if tracker:
        try:
            hidden = frozenset(tracker.hidden_urls())
        except Exception as error:  # A Notion outage shouldn't block the digest.
            print(f'Warning: could not read Notion applications: {error}')
    sources = json.loads((ROOT / 'sources.json').read_text())
    with job_store.connect(args.db) as db:
        # The feed watcher and canonical store intentionally have different schemas.
        # Keep the source-specific history separate, then import the report.
        with watch.database(ROOT / 'data' / 'jobs.sqlite') as feed_db:
            report = watch.scan(sources, feed_db)
        imported = job_store.import_watch_report(db, report)
        if args.company_report.exists():
            company_report = json.loads(args.company_report.read_text())
            imported += job_store.import_company_report(db, company_report)
        if args.enrich_max:
            # Runs after import so fresh descriptions are included. AI trouble never blocks the digest.
            try:
                print(enrich.run(db, enrich.DEFAULT_MODEL, args.enrich_max))
            except Exception as error:
                print(f'Warning: enrichment skipped: {type(error).__name__}: {error}')
        messages, new_count = build_digest(db, args.limit, hidden_urls=hidden)
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
    for message in messages:
        send_telegram(message, token, chat_id)
    print(f'\nSent {len(messages)} Telegram message(s); imported {len(imported)} jobs.')


if __name__ == '__main__':
    main()
