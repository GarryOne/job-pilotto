#!/usr/bin/env python3
"""Find and remove duplicate Job Matches rows (the same job on several rows), with a report first.

    python3 tools/notion_dedupe.py report --db <database id> [--db …] [--page <parent page id>]
        lists every job with more than one row, which row is kept and why; with --page, also as a Notion page
    python3 tools/notion_dedupe.py apply  --db <database id> [--db …]
        moves the extra rows to Notion's trash (restorable there for 30 days)

The token is read from the Keychain (job-pilotto.notion.token, or --token <item>), never printed.
Which row is kept: src/notion/dedupe.py (a decision first: Applied, Dismissed; then the latest score).
"""
import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
from src.notion.dedupe import describe, plan  # noqa: E402
from notion_copy import Notion  # noqa: E402  (rate-limited client, retries)


def keychain(item):
    return subprocess.run(['security', 'find-generic-password', '-s', item, '-w'], capture_output=True, text=True).stdout.strip()


def groups_for(notion, database):
    return plan(list(notion.pages(database)))


def title_of(notion, database):
    return ''.join(t['plain_text'] for t in notion('GET', f'databases/{database}')['title'])


def report_blocks(sections):
    text = lambda s, **a: [{'type': 'text', 'text': {'content': s[:1900], **({'link': {'url': a['link']}} if a.get('link') else {})},
                            'annotations': {'bold': a.get('bold', False), 'code': a.get('code', False)}}]
    blocks = [{'type': 'callout', 'callout': {'icon': {'type': 'emoji', 'emoji': '🧪'}, 'color': 'yellow_background', 'rich_text': text(
        'Check it yourself: open the database, Group by → Job URL. A group with 2+ rows is a duplicate. '
        'Or search one of the job titles below: it shows the extra rows. Removed rows go to Notion\'s Trash (restorable 30 days).')}}]
    for name, groups in sections:
        rows = sum(len(g['drop']) + 1 for g in groups)
        blocks.append({'type': 'heading_2', 'heading_2': {'rich_text': text(f'{name}: {len(groups)} jobs on {rows} rows → {len(groups)} rows ({sum(len(g["drop"]) for g in groups)} extra)')}})
        table = [{'type': 'table_row', 'table_row': {'cells': [text('Job', bold=True), text('Rows', bold=True), text('Kept', bold=True), text('Why', bold=True), text('Removed', bold=True)]}}]
        for g in groups:
            keep = describe(g['keep'])
            removed = []
            for i, p in enumerate(g['drop']):
                d = describe(p)
                removed += text(('' if i == 0 else ' · '), ) + text(f"{d['status']}, scored {d['scored']}", link=d['url'])
            table.append({'type': 'table_row', 'table_row': {'cells': [text(keep['title'], link=g['url']), text(str(len(g['drop']) + 1)),
                          text(f"{keep['status']}, scored {keep['scored']}", link=keep['url']), text(g['why']), removed]}})
        for start in range(0, len(table), 99):  # a table takes at most 100 rows per request
            blocks.append({'type': 'table', 'table': {'table_width': 5, 'has_column_header': True, 'has_row_header': False,
                                                      'children': ([table[0]] if start else []) + table[start:start + 99]}})
    return blocks


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', choices=('report', 'apply'))
    parser.add_argument('--db', action='append', required=True)
    parser.add_argument('--page', help='report: also write it as a Notion page under this page')
    parser.add_argument('--token', default='job-pilotto.notion.token')
    args = parser.parse_args(argv)
    notion = Notion(keychain(args.token))
    sections = []
    for database in args.db:
        name = title_of(notion, database)
        parent = notion('GET', f'databases/{database}')['parent'].get('page_id', '')
        where = ''.join(t['plain_text'] for t in notion('GET', f'pages/{parent}')['properties']['title']['title']) if parent else ''
        groups = groups_for(notion, database)
        sections.append((f'{name} ({where})', groups))
        extra = sum(len(g['drop']) for g in groups)
        print(f'{name} in "{where}": {len(groups)} jobs have more than one row; {extra} extra rows')
        for g in groups[:5]:
            print(f"  e.g. {describe(g['keep'])['title']} — {len(g['drop']) + 1} rows, keep: {g['why']}")
        if args.command == 'apply':
            with ThreadPoolExecutor(3) as pool:  # at Notion's rate limit (the client paces the requests)
                list(pool.map(lambda p: notion('PATCH', f"pages/{p['id']}", {'archived': True}),
                              [p for g in groups for p in g['drop']]))
            print(f'  moved {extra} rows to the trash')
    if args.command == 'report' and args.page:
        made = notion('POST', 'pages', {'parent': {'page_id': args.page}, 'icon': {'type': 'emoji', 'emoji': '🧹'},
                                        'properties': {'title': {'title': [{'text': {'content': 'Job Matches duplicates — report'}}]}}})
        blocks = report_blocks(sections)
        for block in blocks:
            notion('PATCH', f"blocks/{made['id']}/children", {'children': [block]})
        print('Report page:', made['url'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
