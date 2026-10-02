"""No-AI steps of the daily self-fix run (fix-issues.yml): stale close, snapshot-only issue pick, Claude log summary.

Closes fill-failure issues from an extension 2+ minor versions old, picks the oldest issue Claude can work on
(fill-failure: only one with a field snapshot) and turns Claude's execution log into the job summary.

  python3 tools/fix_issues.py stale [--apply]                  list (or comment on + close) stale fill-failure issues
  python3 tools/fix_issues.py pick --label L [--issue N] [--mark]  print today's issue number (nothing = none);
                                                                   --mark labels snapshot-less ones needs-snapshot once
  python3 tools/fix_issues.py log-summary FILE                 Markdown: turns, cost, permission denials (tool + input)
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_MARK = '<!-- job-pilotto:snapshot v1 -->'  # written by fill-failure-intake.yml
NEEDS_SNAPSHOT = 'needs-snapshot'
STALE_MINOR_GAP = 2  # 0.6.x is stale when the extension is at 0.8.x
_VERSION = re.compile(r'(\d+)\.(\d+)(?:\.(\d+))?')


def parse_version(text):
    m = _VERSION.search(text or '')
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)) if m else None


def texts(issue):
    return [issue.get('body') or ''] + [c.get('body') or '' for c in issue.get('comments') or []]


def reported_version(issue):
    """The newest extension version the issue was reported (or seen again) with."""
    found = []
    for text in texts(issue):
        for pattern in (r'Extension version: `([^`]+)`', r'Seen again with extension ([0-9][0-9.]*)'):
            found += [v for v in (parse_version(s) for s in re.findall(pattern, text)) if v]
    return max(found) if found else None


def is_stale(reported, current):
    if not reported or not current:
        return False
    if reported[0] != current[0]:
        return reported[0] < current[0]
    return current[1] - reported[1] >= STALE_MINOR_GAP


def has_snapshot(issue):
    return any(SNAPSHOT_MARK in text for text in texts(issue))


def labels(issue):
    return {label['name'] for label in issue.get('labels') or []}


def fmt(version):
    return '.'.join(map(str, version)) if version else '?'


def stale_comment(reported, current):
    return (f'Reported by extension {fmt(reported)}, current is {fmt(current)}; closing — it will be reopened '
            'automatically if it happens again on a new version.')


def choose(issues, label):
    """(number or None, snapshot-less issues skipped on the way). Oldest first, never one already attempted."""
    skipped = []
    for issue in sorted(issues, key=lambda i: (i.get('createdAt') or '', i['number'])):
        if 'fix-attempted' in labels(issue):
            continue
        if label == 'fill-failure' and not has_snapshot(issue):
            skipped.append(issue)
            continue
        return issue['number'], skipped
    return None, skipped


def summarize_log(messages):
    """Markdown for the job summary from the action's execution file (a JSON list of SDK messages)."""
    result = next((m for m in reversed(messages) if isinstance(m, dict) and m.get('type') == 'result'), {})
    lines = [f"- Result: `{result.get('subtype', 'unknown')}`, {result.get('num_turns', '?')} turns"
             + (f", ${result['total_cost_usd']:.2f}" if isinstance(result.get('total_cost_usd'), (int, float)) else '')]
    denials = result.get('permission_denials')
    if denials is None:  # older CLIs: find the tool calls whose result says permission was refused
        calls = {}
        denials = []
        for m in messages:
            for block in ((m.get('message') or {}).get('content') or []) if isinstance(m, dict) else []:
                if not isinstance(block, dict):
                    continue
                if block.get('type') == 'tool_use':
                    calls[block.get('id')] = block
                elif block.get('type') == 'tool_result' and block.get('is_error') and \
                        'permission' in json.dumps(block.get('content')).lower():
                    call = calls.get(block.get('tool_use_id'), {})
                    denials.append({'tool_name': call.get('name', '?'), 'tool_input': call.get('input')})
    lines.append(f'- Permission denials: {len(denials)}')
    for d in denials:
        tool_input = json.dumps(d.get('tool_input'), ensure_ascii=False) if d.get('tool_input') is not None else ''
        tool_input = tool_input.replace('`', "'")
        lines.append(f"  - `{d.get('tool_name', '?')}`" + (f' `{tool_input[:300]}`' if tool_input else ''))
    return '\n'.join(lines)


def load_messages(path):
    raw = Path(path).read_text()
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else [data]
    except json.JSONDecodeError:  # JSON lines
        return [json.loads(line) for line in raw.splitlines() if line.strip()]


# --- GitHub (gh CLI) -------------------------------------------------------------------------------------------------
def gh(*args, check=True):
    repo = ['--repo', os.environ['REPO']] if os.environ.get('REPO') else []
    out = subprocess.run(['gh', *args, *repo], capture_output=True, text=True, check=False)
    if check and out.returncode:
        raise SystemExit(f"gh {' '.join(args[:3])}: {out.stderr.strip()}")
    return out.stdout


def open_issues(label):
    return json.loads(gh('issue', 'list', '--state', 'open', '--label', label, '--limit', '200',
                         '--json', 'number,title,createdAt,labels,body,comments') or '[]')


def current_version():
    """The extension's current version, from env EXTENSION_VERSION (the extension is in a private repo now, so there is no manifest
    here). Unset: None, and nothing is closed as stale."""
    version = os.environ.get('EXTENSION_VERSION', '').strip()
    return parse_version(version) if version else None


def summary(line):
    print(line)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
            f.write(line + '\n')


def cmd_stale(args):
    current = current_version()
    stale = [(i, reported_version(i)) for i in open_issues('fill-failure')]
    stale = [(i, v) for i, v in stale if is_stale(v, current)]
    if not stale:
        print(f'No stale fill-failure issue (extension {fmt(current)}).')
    for issue, reported in stale:
        verb = 'Closed' if args.apply else 'Would close'
        summary(f"- {verb} #{issue['number']} as stale (extension {fmt(reported)}, current {fmt(current)}): {issue['title']}")
        if args.apply:
            gh('issue', 'comment', str(issue['number']), '--body', stale_comment(reported, current))
            gh('issue', 'close', str(issue['number']), '--reason', 'not planned')


def cmd_pick(args):
    if args.issue:
        issue = json.loads(gh('issue', 'view', str(args.issue), '--json', 'number,title,state,createdAt,labels,body,comments'))
        issues = [issue] if issue.get('state') == 'OPEN' and args.label in labels(issue) else []
        for i in issues:
            i['labels'] = [x for x in i['labels'] if x['name'] != 'fix-attempted']  # asked by hand: try again
    else:
        issues = open_issues(args.label)
    number, skipped = choose(issues, args.label)
    if args.mark:
        fresh = [i for i in skipped if NEEDS_SNAPSHOT not in labels(i)]
        if fresh:
            gh('label', 'create', NEEDS_SNAPSHOT, '--color', 'BFD4F2', '--force',
               '--description', 'Waiting for a field snapshot (extension 0.8.16+) before the self-fix run', check=False)
        for i in fresh:
            gh('issue', 'edit', str(i['number']), '--add-label', NEEDS_SNAPSHOT, check=False)
        if number:
            chosen = next(i for i in issues if i['number'] == number)
            if NEEDS_SNAPSHOT in labels(chosen):
                gh('issue', 'edit', str(number), '--remove-label', NEEDS_SNAPSHOT, check=False)
    if skipped:
        print(f"Skipped (no snapshot): {' '.join('#%d' % i['number'] for i in skipped)}", file=sys.stderr)
    if number:
        print(number)
    elif args.label == 'fill-failure' and skipped:
        summary(f'### {args.label}: no issue with a snapshot ({len(skipped)} waiting for one; no Claude run)')
    else:
        summary(f'### {args.label}: no open issue to fix today')


def cmd_log_summary(args):
    path = Path(args.file)
    if not path.is_file():
        print(f'- No execution log at `{path}` (Claude did not start).')
        return
    print(summarize_log(load_messages(path)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('stale')
    p.add_argument('--apply', action='store_true')
    p.set_defaults(func=cmd_stale)
    p = sub.add_parser('pick')
    p.add_argument('--label', required=True, choices=['fill-failure', 'telemetry'])
    p.add_argument('--issue', type=int)
    p.add_argument('--mark', action='store_true')
    p.set_defaults(func=cmd_pick)
    p = sub.add_parser('log-summary')
    p.add_argument('file')
    p.set_defaults(func=cmd_log_summary)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == '__main__':
    main()
