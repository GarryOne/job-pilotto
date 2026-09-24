#!/usr/bin/env python3
"""Queue every ready application kit into the ChatGPT/Codex desktop app, one chat each.

"Ready" = a job Saved in Notion Applications with a kit already drafted (by 📝 Prepare or the
auto-kit step) and not yet Applied/Dismissed. For each, pastes (and by default sends) a plain-text
prompt built from the kit into a new Codex chat via tools/send-to-chatgpt.sh.

Codex fills the form and stops before Submit on its own (its "Ask for approval" gate); review each
chat, click Submit yourself, then mark it applied. There is no tool to read a chat's result back,
so the owner is the one watching every chat this queues.

Usage: python -m src.ai.apply_batch [--max 5] [--paste-only] [--dry-run]
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from .kit import KIT_HEADING
from ..notion import client as notion

REPO_ROOT = Path(__file__).resolve().parents[2]
SEND_SCRIPT = REPO_ROOT / 'tools' / 'send-to-chatgpt.sh'
DEFAULT_CV = os.getenv('SRE_WATCH_CV_PATH', str(Path.home() / 'Documents' / 'CV.pdf'))

PROMPT = """Open a browser, navigate to {url}, and fill out the job application form. Do not \
click Submit — stop once every field is filled and show me a summary.

{fields}

Resume: attach {cv}

If a field appears that isn't listed above, don't guess — ask me."""


def _title(row):
    return ''.join(t.get('plain_text', '') for t in row['properties']['Job'].get('title', []))


def ready_jobs(tracker, max_jobs):
    """(row, kit) pairs for Saved jobs that have a kit, newest-updated first."""
    rows = tracker.query_database(tracker.database_id, {'property': 'Stage', 'select': {'equals': 'Saved'}})
    rows.sort(key=lambda r: r.get('last_edited_time', ''), reverse=True)
    pairs = []
    for row in rows:
        kit_data = tracker.read_kit(row['id'], KIT_HEADING)
        if kit_data:
            pairs.append((row, kit_data))
        if len(pairs) >= max_jobs:
            break
    return pairs


def build_prompt(kit_data, cv):
    lines = [f"- Cover letter: {kit_data['cover_letter']}"]
    for answer in kit_data['answers']:
        if answer['answer']:
            lines.append(f"- {answer['question']}: {answer['answer']}")
    return PROMPT.format(url=kit_data['url'], fields='\n'.join(lines), cv=cv)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max', type=int, default=5, help='at most this many chats')
    parser.add_argument('--cv', default=str(DEFAULT_CV))
    parser.add_argument('--paste-only', action='store_true',
                        help="don't press Return in each chat; review the pasted text first")
    parser.add_argument('--gap', type=float, default=3.0, help='seconds between chats')
    parser.add_argument('--dry-run', action='store_true', help='print what would run; touch nothing')
    args = parser.parse_args()

    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required (Keychain entry sre-watch.notion.token, or export it)')
    if not SEND_SCRIPT.exists():
        raise SystemExit(f'{SEND_SCRIPT} not found')

    pairs = ready_jobs(tracker, args.max)
    if not pairs:
        print('No Saved jobs with a kit ready. Prepare one first: 📝 Prepare in Telegram, or '
              '`gh workflow run daily.yml -f mode=prepare -f job=<job URL>`.')
        return 0

    for row, kit_data in pairs:
        title, company = _title(row), row['properties'].get('Company', {})
        company = ''.join(t.get('plain_text', '') for t in company.get('rich_text', []))
        prompt = build_prompt(kit_data, args.cv)
        print(f"--- {title} — {company} ({kit_data['url']}) ---")
        if args.dry_run:
            print(prompt)
            continue
        with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False) as handle:
            handle.write(prompt)
            path = handle.name
        cmd = [str(SEND_SCRIPT)] + ([] if args.paste_only else ['--send']) + ['-f', path]
        subprocess.run(cmd, check=True)
        # Mark it out of 'Saved' immediately so a second run (or the next auto-kit cycle) never
        # queues the same job into a second chat. Re-queue a job by setting its Stage back to
        # Saved in Notion if a paste-only chat was abandoned without sending.
        tracker.mark({'url': kit_data['url']}, 'Applying')
        time.sleep(args.gap)

    print(f"\nQueued {len(pairs)} chat(s) in the ChatGPT/Codex app. For each: review, attach the "
          "résumé if it didn't, click Submit yourself, then run:\n"
          "  gh workflow run daily.yml -R GarryOne/sre-watch -f mode=apply -f job=<job URL> -f action=applied")
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
