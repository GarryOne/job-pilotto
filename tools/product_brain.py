"""The product brain's plumbing (.github/workflows/product-brain.yml): Claude decides, this script reads and writes.

  signals  --out signals.md      what the brief reads: website + app numbers (/api/signals), GitHub (issues, failing
                                 workflows, releases, commits), and the brain's own past decisions (Notion)
  post     --brief brief.json    one recommendation -> a row in "🧭 Product Brain · Decisions" + a Telegram card
                                 with ✅ Explore / ⏭ Not now / 🔁 Another idea
  decision --id <page>           a decision as text (the explore step's input)
  plan     --id <page> --file plan.md   the explored plan -> the decision's page, Telegram: ✅ Approve / ✖ Drop
  status   --id <page> --status <name> [--note text]   a button's answer, recorded (and acknowledged in Telegram)

Nothing here decides or builds: the two approval gates are the owner's taps in the "Job Pilotto Brain" Telegram bot
(site/src/brain.js). Needs NOTION_BRAIN_TOKEN (a Notion connection that sees only the Decisions database),
BRAIN_DATABASE_ID, BRAIN_BOT_TOKEN, BRAIN_CHAT_ID, JOB_PILOTTO_TELEMETRY_KEY (the site's STATS_KEY) and GH_TOKEN.
Standard library only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

DATABASE = os.environ.get('BRAIN_DATABASE_ID', '')  # repository variable; Notion IDs never default in code
SIGNALS_URL = 'https://www.jobpilotto.workers.dev/api/signals?days=7'
NOTION = 'https://api.notion.com/v1'
LENSES = ['Growth', 'Product', 'Quality', 'UX', 'Business']  # Monday..Friday; the weekend picks by evidence
STATUSES = ['Proposed', 'Exploring', 'Plan ready', 'Approved', 'Not now', 'Done']


def lens_of_the_day(day: dt.date) -> str:
    return LENSES[day.weekday()] if day.weekday() < 5 else 'any (pick by evidence)'


# ---- HTTP ----

def _request(url: str, method: str = 'GET', body: dict | None = None, headers: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as error:
        raise SystemExit(f'{method} {url.split("?")[0]} failed: {error.code} {error.read()[:300]!r}')


def notion(path: str, method: str = 'GET', body: dict | None = None) -> dict:
    token = os.environ.get('NOTION_BRAIN_TOKEN')
    if not DATABASE:
        raise SystemExit('BRAIN_DATABASE_ID is missing: the repository variable with the Decisions database id.')
    if not token:
        raise SystemExit('NOTION_BRAIN_TOKEN is missing: create the "Job Pilotto Brain" Notion connection (RELEASE.md, Product brain).')
    return _request(f'{NOTION}/{path}', method, body, {'Authorization': f'Bearer {token}', 'Notion-Version': '2022-06-28'})


def telegram(text: str, buttons: list[list[dict]] | None = None) -> None:
    token, chat = os.environ.get('BRAIN_BOT_TOKEN'), os.environ.get('BRAIN_CHAT_ID')  # the Brain bot, not the job bot
    if not token or not chat:
        print('Telegram not configured: message not sent.', file=sys.stderr)
        return
    body = {'chat_id': chat, 'text': text[:4000], 'parse_mode': 'HTML', 'disable_web_page_preview': True}
    if buttons:
        body['reply_markup'] = {'inline_keyboard': buttons}
    _request(f'https://api.telegram.org/bot{token}/sendMessage', 'POST', body)


def esc(text: str) -> str:
    return str(text or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def plain(prop: dict) -> str:
    kind = prop.get('type')
    if kind in ('title', 'rich_text'):
        return ''.join(part.get('plain_text', '') for part in prop.get(kind) or [])
    if kind == 'select':
        return (prop.get('select') or {}).get('name', '')
    if kind == 'date':
        return (prop.get('date') or {}).get('start', '')
    return ''


def text(value: str) -> list[dict]:
    return [{'type': 'text', 'text': {'content': value[:1990]}}] if value else []


# ---- Markdown -> Notion blocks (headings, bullets, numbered, to-dos, paragraphs: what the prompts ask for) ----

def blocks(markdown: str) -> list[dict]:
    out = []
    for line in markdown.splitlines():
        line = line.rstrip()
        if not line.strip():
            continue
        for prefix, kind in (('### ', 'heading_3'), ('## ', 'heading_2'), ('# ', 'heading_2')):
            if line.startswith(prefix):
                out.append({'type': kind, kind: {'rich_text': text(line[len(prefix):])}})
                break
        else:
            todo = re.match(r'^\s*[-*] \[( |x)\] (.*)', line)
            bullet = re.match(r'^\s*[-*] (.*)', line)
            number = re.match(r'^\s*\d+[.)] (.*)', line)
            if todo:
                out.append({'type': 'to_do', 'to_do': {'rich_text': text(todo.group(2)), 'checked': todo.group(1) == 'x'}})
            elif bullet:
                out.append({'type': 'bulleted_list_item', 'bulleted_list_item': {'rich_text': text(bullet.group(1))}})
            elif number:
                out.append({'type': 'numbered_list_item', 'numbered_list_item': {'rich_text': text(number.group(1))}})
            else:
                out.append({'type': 'paragraph', 'paragraph': {'rich_text': text(line)}})
    return out


def append(page: str, markdown: str) -> None:
    items = blocks(markdown)
    for start in range(0, len(items), 90):  # Notion takes at most 100 blocks per call
        notion(f'blocks/{page}/children', 'PATCH', {'children': items[start:start + 90]})


# ---- signals ----

def _run(args: list[str]) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=60, check=False).stdout.strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        return f'(not available: {error})'


def past_decisions(limit: int = 30) -> list[dict]:
    found = notion(f'databases/{DATABASE}/query', 'POST',
                   {'page_size': limit, 'sorts': [{'property': 'Date', 'direction': 'descending'}]})
    return [{'id': row['id'], **{name: plain(prop) for name, prop in row['properties'].items()}} for row in found.get('results', [])]


def signals(out: str, today: dt.date) -> None:
    key = os.environ.get('JOB_PILOTTO_TELEMETRY_KEY')
    numbers = _request(SIGNALS_URL, headers={'Authorization': f'Bearer {key}'}) if key else {'error': 'JOB_PILOTTO_TELEMETRY_KEY missing'}
    since = (today - dt.timedelta(days=7)).isoformat()
    sections = [
        f'# Signals for {today.isoformat()} ({today.strftime("%A")}) · lens of the day: {lens_of_the_day(today)}',
        '## Website and app (last 7 days, /api/signals: counts only)', '```json', json.dumps(numbers, indent=1)[:12000], '```',
        '## Open GitHub issues (newest 30)',
        _run(['gh', 'issue', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title,labels,createdAt',
              '-q', '.[] | "#\\(.number) \\(.createdAt[:10]) \\(.title) [\\([.labels[].name] | join(","))]"']),
        '## Workflow runs that failed in the last 7 days',
        _run(['gh', 'run', 'list', '--limit', '200', '--status', 'failure', '--created', f'>={since}', '--json', 'workflowName,createdAt',
              '-q', 'group_by(.workflowName)[] | "\\(.[0].workflowName): \\(length) failed"']),
        '## Releases (newest 5)', _run(['gh', 'release', 'list', '--limit', '5']),
        '## Commits in the last 7 days', _run(['git', 'log', f'--since={since}', '--format=%ad %h %s', '--date=short']),
        '## Past decisions of the brain (newest first; do not repeat one marked Not now within 14 days)',
        json.dumps(past_decisions(), indent=1, ensure_ascii=False),
    ]
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    with open(out, 'w', encoding='utf-8') as file:
        file.write('\n\n'.join(sections) + '\n')
    print(f'Signals written to {out}')


# ---- post / decision / plan / status ----

def card(brief: dict, page_url: str) -> str:
    return (f'🧭 <b>Today\'s one action · {esc(brief["lens"])}</b>\n{esc(brief.get("evidence", ""))}\n\n'
            f'→ <b>{esc(brief["action"])}</b>\n{esc(brief.get("why", ""))}\n'
            f'Effort {esc(brief.get("effort", "?"))} · expected {esc(brief.get("expected", "?"))}\n<a href="{page_url}">Details</a>')


def post(path: str, today: dt.date) -> str:
    brief = json.load(open(path, encoding='utf-8'))
    for field in ('action', 'lens'):
        if not brief.get(field):
            raise SystemExit(f'brief.json has no "{field}"')
    lens = brief['lens'] if brief['lens'] in LENSES + ['Fire'] else 'Product'
    check = today + dt.timedelta(days=int(brief.get('check_in_days') or 7))
    page = notion('pages', 'POST', {'parent': {'database_id': DATABASE}, 'properties': {
        'Action': {'title': text(brief['action'])}, 'Date': {'date': {'start': today.isoformat()}},
        'Lens': {'select': {'name': lens}}, 'Status': {'select': {'name': 'Proposed'}},
        'Why now': {'rich_text': text(brief.get('why', ''))}, 'Effort': {'rich_text': text(brief.get('effort', ''))},
        'Expected': {'rich_text': text(brief.get('expected', ''))}, 'Check on': {'date': {'start': check.isoformat()}}}})
    append(page['id'], brief.get('details', ''))
    ident = page['id'].replace('-', '')
    telegram(card({**brief, 'lens': lens}, page['url']), [[
        {'text': '✅ Explore it', 'callback_data': f'pb:x:{ident}'},
        {'text': '⏭ Not now', 'callback_data': f'pb:n:{ident}'},
        {'text': '🔁 Another idea', 'callback_data': f'pb:a:{ident}'}]])
    print(page['url'])
    return page['id']


def decision(page: str) -> str:
    row = notion(f'pages/{page}')
    props = {name: plain(prop) for name, prop in row['properties'].items()}
    children = notion(f'blocks/{page}/children?page_size=100').get('results', [])
    body = '\n'.join(''.join(part.get('plain_text', '') for part in (block.get(block['type']) or {}).get('rich_text', []))
                     for block in children)
    return '\n'.join(f'{name}: {value}' for name, value in props.items() if value) + f'\n\nDetails:\n{body}\n'


def plan(page: str, path: str) -> None:
    markdown = open(path, encoding='utf-8').read()
    append(page, '## Explored plan\n' + markdown)
    row = notion(f'pages/{page}', 'PATCH', {'properties': {'Status': {'select': {'name': 'Plan ready'}}}})
    summary = next((line.strip('# ').strip() for line in markdown.splitlines() if line.strip()), 'Plan ready')
    ident = page.replace('-', '')
    telegram(f'🧭 <b>Plan ready</b>: {esc(plain(row["properties"]["Action"]))}\n{esc(summary)}\n<a href="{row["url"]}">Read the plan</a>',
             [[{'text': '✅ Approve plan', 'callback_data': f'pb:ok:{ident}'}, {'text': '✖ Drop it', 'callback_data': f'pb:n:{ident}'}]])


def status(page: str, name: str, note: str = '') -> None:
    if name not in STATUSES:
        raise SystemExit(f'unknown status {name}: one of {", ".join(STATUSES)}')
    props = {'Status': {'select': {'name': name}}}
    if note:
        props['Result'] = {'rich_text': text(note)}
    row = notion(f'pages/{page}', 'PATCH', {'properties': props})
    print(f'{plain(row["properties"]["Action"])}: {name}')


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='cmd', required=True)
    sub.add_parser('signals').add_argument('--out', default='signals.md')
    sub.add_parser('post').add_argument('--brief', default='brief.json')
    sub.add_parser('decision').add_argument('--id', required=True)
    p = sub.add_parser('plan')
    p.add_argument('--id', required=True)
    p.add_argument('--file', default='plan.md')
    s = sub.add_parser('status')
    s.add_argument('--id', required=True)
    s.add_argument('--status', required=True)
    s.add_argument('--note', default='')
    args = parser.parse_args(argv)
    today = dt.datetime.now(dt.timezone.utc).date()
    if args.cmd == 'signals':
        signals(args.out, today)
    elif args.cmd == 'post':
        post(args.brief, today)
    elif args.cmd == 'decision':
        print(decision(args.id))
    elif args.cmd == 'plan':
        plan(args.id, args.file)
    else:
        status(args.id, args.status, args.note)


if __name__ == '__main__':
    main()
