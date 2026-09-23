#!/usr/bin/env python3
"""Run the local scan, import canonical state and optionally send Telegram digest."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request

import job_store
import watch

ROOT = Path(__file__).resolve().parent


def format_digest(db, limit=10):
    jobs = job_store.digest_jobs(db, limit=limit, only_new=True)
    all_jobs = job_store.digest_jobs(db, limit=limit, only_new=False)
    chosen = jobs or all_jobs
    lines = [f"SRE Watch · {len(jobs)} new jobs" if jobs else "SRE Watch · no new jobs"]
    for index, job in enumerate(chosen, 1):
        location = job.get('location') or 'Location not stated'
        lines.append(f"\n{index}. {job['title']} — {job['company']}\n{location} · {job.get('work_mode') or 'work mode not stated'}\n{job['url']}")
    return '\n'.join(lines)


def send_telegram(text, token, chat_id):
    endpoint = f"https://api.telegram.org/bot{token}/sendMessage"
    body = urllib.parse.urlencode({'chat_id': chat_id, 'text': text, 'disable_web_page_preview': 'true'}).encode()
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
    parser.add_argument('--limit', type=int, default=10)
    parser.add_argument('--send', action='store_true', help='send to Telegram; otherwise print preview only')
    args = parser.parse_args()
    if not 1 <= args.limit <= 50:
        parser.error('--limit must be between 1 and 50')
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
        message = format_digest(db, args.limit)
    (ROOT / 'reports').mkdir(parents=True, exist_ok=True)
    (ROOT / 'reports' / 'daily-latest.txt').write_text(message + '\n', encoding='utf-8')
    (ROOT / 'reports' / 'daily-latest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(message)
    if not args.send:
        print('\nPreview only. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then rerun with --send.')
        return 0
    token, chat_id = os.getenv('TELEGRAM_BOT_TOKEN') or keychain_token(), os.getenv('TELEGRAM_CHAT_ID')
    if not token or not chat_id:
        raise SystemExit('--send requires TELEGRAM_CHAT_ID and either TELEGRAM_BOT_TOKEN or the local Keychain entry')
    send_telegram(message, token, chat_id)
    print(f'\nSent Telegram digest; imported {len(imported)} jobs.')


if __name__ == '__main__':
    main()
