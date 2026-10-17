"""Checks the screens of a PR description (owner, 17 Oct 2026, on #1290: "Just screens, it's not clear. Let it follow ALWAYS the columns Before/After. And explain what changed.
Basically: where to look."). Every image sits in a table `| What changed | Before | After |`, one row per change: a caption of a few words (what changed, where to look),
the before image, the after image. A new screen has no before: "—" there, and the caption says why. Reads the body on stdin; exit 1 naming each gap.
Used by tools/pr-body.sh (at ship time) and tools/pr-body-check.py (in CI, so a body edited on GitHub is checked too). Guard: tests/test_pr_body.py."""
import re
import sys

IMAGE = re.compile(r'!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>', re.I)
HEADER = re.compile(r'^\|\s*What changed\s*\|\s*Before\s*\|\s*After\s*\|\s*$', re.I)
ROW_FIX = 'every image sits in a row of | What changed | Before | After |, e.g. | The Availability card says "Start date" under the dropdown | ![before](url) | ![after](url) |'
NO_SIDE = {'', '—', '-', '–'}


def cells(line):
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def problems(body):
    out, in_table = [], False
    for number, line in enumerate(body.replace('\r\n', '\n').split('\n'), 1):
        found = IMAGE.findall(line)
        if HEADER.match(line.strip()):
            in_table = True
            continue
        if not line.strip().startswith('|'):
            in_table = False
        if re.match(r'^\|[\s:|-]+\|$', line.strip()):
            continue
        if not found:
            continue
        if not in_table:
            out.append(f'line {number}: an image outside the screens table: {ROW_FIX}')
            continue
        row = cells(line)
        if len(row) != 3:
            out.append(f'line {number}: a screens row has {len(row)} cells, not 3 (What changed | Before | After): {ROW_FIX}')
            continue
        caption, before, after = row
        if IMAGE.search(caption):
            out.append(f'line {number}: the image is in the "What changed" cell: the caption says what changed and where to look, the images go under Before and After')
            continue
        words = len(re.findall(r'\w+', caption))
        if words < 3:
            out.append(f'line {number}: a screens row has no caption (what changed, where to look): {ROW_FIX}')
        for side, text in (('Before', before), ('After', after)):
            if not IMAGE.search(text) and text not in NO_SIDE:
                out.append(f'line {number}: the {side} cell has neither an image nor "—"')
        if (before in NO_SIDE or after in NO_SIDE) and words < 6:
            out.append(f'line {number}: a row with only one side ("—") needs the reason in its caption (a new screen, a removed one)')
    return out


if __name__ == '__main__':
    gaps = problems(sys.stdin.read())
    if gaps:
        print('pr-screens: ' + '; '.join(gaps), file=sys.stderr)
        sys.exit(1)
