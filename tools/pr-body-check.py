"""Checks that a PR description is laid out by tools/pr-body-format.py (owner, 16 Oct 2026: "this PR description missed our rules: didn't add separators,
didn't use headings"). #1043's body was replaced with `gh pr edit --body-file` on a raw summary, which skips the formatter that tools/ship.sh runs.
Reads the body on stdin; exit 1 naming what is missing. Run by the step "PR description laid out" of .github/workflows/pr-gate.yml on every opened, pushed or edited PR. Guard: tests/test_pr_body.py."""
import importlib.util
import os
import re
import sys

FIX = 'lay it out with tools/pr-body.sh <base> --body=<summary> (ship.sh does it), never a raw `gh pr edit --body-file`'


def missing(body):
    lines = [line for line in body.replace('\r\n', '\n').split('\n')]
    first = next((line for line in lines if line.strip()), '')
    out = []
    if not first.startswith('## '):
        out.append('the verdict line is not a "## " heading')
    if not any(re.match(r'^-{3,}\s*$', line) for line in lines):
        out.append('no "---" separator between sections')
    if not any(line.startswith('### ') for line in lines):
        out.append('no "### " section heading (Impact, What changed, Before → After)')
    spec = importlib.util.spec_from_file_location('pr_screens', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pr-screens.py'))
    screens = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(screens)
    out += screens.problems(body)   # every image in a | What changed | Before | After | row (tools/pr-screens.py)
    return out


TAG_FIX = 'the title starts with the opening session\'s tag, e.g. "[75] Fix the thing": tools/ship.sh adds it (re-run it), or `gh pr edit <n> --title "[xx] <title>"`'


def title_gap(title):
    """21 Oct 2026: site#18 and #19 had no "[xx] " tag (opened or retitled by hand). PR_TITLE is set by pr-gate.yml / the site's tests.yml (empty for a bot's PR: no check)."""
    return None if not title or re.match(r'^\[[^\]]+\] \S', title) else f'the PR title "{title}" has no "[xx] " session tag: {TAG_FIX}'


if __name__ == '__main__':
    gaps = missing(sys.stdin.read())
    gap = title_gap(os.environ.get('PR_TITLE', '').strip())
    if gap:
        print('pr-title: ' + gap, file=sys.stderr)
        sys.exit(1)
    if gaps:
        print('pr-description: ' + '; '.join(gaps) + ': ' + FIX, file=sys.stderr)
        sys.exit(1)
    print('pr-description: laid out (headings and separators)')
