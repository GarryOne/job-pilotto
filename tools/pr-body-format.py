"""Lays out a PR summary for GitHub (owner, 15 Oct 2026: "use headings, font sizes, proper spacing; a run number is a link, not plain text").
Reads the session's summary (tools/pr-body-template.md shape) on stdin, prints it with: the verdict as a big heading, Why/Unblocks in a callout,
a small heading over each block (impact, what changed, before/after, screens), a quiet "No screenshots" line, and every "run <id>" linked
to its Actions run. Lines the CI reads (live-row: ...) and anything already under a heading stay as written. Guard: tests/test_pr_body.py.
Usage: python3 tools/pr-body-format.py <owner/repo or ''> < summary.md"""
import re
import sys

RUN = re.compile(r'(?<![\[/\w])run (\d{8,})\b(?![\]\w])')
HEADINGS = [   # (what starts the block, its heading)
    (re.compile(r'^\|\s*Area\s*\|\s*Impact\b', re.I), '### 📊 Impact'),
    (re.compile(r'^\|[^|]*\|\s*Before\s*\|\s*After\b', re.I), '### 🔍 Before → After'),
    (re.compile(r'^- '), '### ✅ What changed'),
    (re.compile(r'^(\*\*Before\*\*|!\[|<img |\|\s*!\[)', re.I), '### 🖼️ Screens'),
]
NOTE = re.compile(r'^\*\*(Why|Unblocks):?\*\*:?', re.I)


def link_runs(line, repo):
    return RUN.sub(lambda m: f'[run {m.group(1)}](https://github.com/{repo}/actions/runs/{m.group(1)})', line) if repo else line


def lay_out(text, repo=''):
    lines = text.rstrip('\n').split('\n')
    if any(line.startswith('### ') or line.startswith('## ') for line in lines[1:]):
        return '\n'.join(link_runs(line, repo) for line in lines) + '\n'   # the author laid it out already: links only
    out, used, note, first = [], set(), [], True
    for line in lines:
        line = link_runs(line, repo)
        if first and line.strip():
            first = False
            out.append(line if line.startswith('#') else '## ' + line)
            continue
        if NOTE.match(line):
            note.append(line)
            continue
        if note and not line.strip():
            continue
        if note:   # the Why/Unblocks lines end: one callout, a blank line between them
            out += ['', '> [!NOTE]', *sum((['> ' + n, '>'] for n in note), [])[:-1], '']
            note = []
        if line.startswith('No screenshots:') or line.startswith('No visual:'):
            out.append('<sub>📷 ' + line + '</sub>')
            continue
        for start, heading in HEADINGS:
            if heading not in used and start.match(line) and (not out or not out[-1].startswith('|') and not out[-1].startswith('- ')):
                used.add(heading)
                if out and out[-1].strip():
                    out.append('')
                out += [heading, '']
                break
        out.append(line)
    if note:
        out += ['', '> [!NOTE]', *sum((['> ' + n, '>'] for n in note), [])[:-1]]
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip('\n') + '\n'


if __name__ == '__main__':
    sys.stdout.write(lay_out(sys.stdin.read(), sys.argv[1] if len(sys.argv) > 1 else ''))
