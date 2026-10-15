#!/usr/bin/env bash
# The description of a PR that tools/ship.sh opens (owner, 12 Oct 2026: "I have 2-5 seconds to look at it; not an essay"). Guard: tests/test_pr_body.py.
#   tools/pr-body.sh <base> [--body=<file>]   prints the body for the commits <base>..HEAD
# Top: the session's 5-second summary (--body=<file>, template tools/pr-body-template.md: an emoji verdict line, **Why**, **Unblocks**, the coloured impact table, a few short bullets, a Before/After table, images when a screen changed: refused without them), else the first subject.
# Then a table of the trailers' facts (pool row, rung, fixture, ...). The commit messages are folded in a <details>, never above it.
set -euo pipefail
base="${1:?usage: tools/pr-body.sh <base> [--body=<file>]}"; summary=""
for arg in "${@:2}"; do case "$arg" in --body=*) summary="${arg#--body=}" ;; esac; done
# A summary says WHY (owner, 13 Oct 2026: "explaining why a change is needed: how we decided that we need this. And a before/after"): a "**Why**" line naming the
# incident, measurement or owner request behind it, and a table with Before and After columns. Missing either: refused, saying which.
if [ -n "$summary" ] && [ -s "$summary" ]; then
  grep -qiE '\*\*why\b' "$summary" || { echo 'pr-body: the summary has no "**Why:**" line: say how we decided this is needed (the incident, measurement or owner request behind it)' >&2; exit 2; }
  grep -qiE '^\|.*\bBefore\b.*\|.*\bAfter\b' "$summary" || { echo 'pr-body: the summary has no Before/After table: | | Before | After | with the measured or seen difference' >&2; exit 2; }
  # Impact, in colour, per area (owner, 15 Oct 2026: "drop the chart, hard to read; more visual presence, colours and emoji; the impact, how it helps,
  # what it unblocks, which category it improves"). Template: tools/pr-body-template.md. Required: a verdict line starting with an emoji, an "**Unblocks:**" line,
  # and the impact table: one row per area, rated 🟢 High · 🟡 Medium · ⚪ Low · — None, with how. Missing a part: refused, naming it.
  head1="$(grep -m1 -vE '^\s*$' "$summary")"
  printf '%s' "$head1" | LC_ALL=C grep -q '^[[:print:]]' && ! printf '%s' "$head1" | grep -qE '^#+ [^[:alnum:][:space:]]' && { echo 'pr-body: the first line must start with an emoji verdict (e.g. "🟢 The form AI now …"): see tools/pr-body-template.md' >&2; exit 2; }
  grep -qiE '\*\*unblocks\b' "$summary" || { echo 'pr-body: the summary has no "**Unblocks:**" line: say exactly what this solves or unblocks (a PR, a session, a number, a person): see tools/pr-body-template.md' >&2; exit 2; }
  for area in 'Real users' 'Form filling' 'Admin data accuracy' 'Offline replays' 'Tests & harness' 'Development speed' 'Cost'; do
    grep -qE "^\|[^|]*${area}[^|]*\|[^|]*(🟢|🟡|⚪|—)[^|]*(High|Medium|Low|None)" "$summary" || { echo "pr-body: the impact table has no rated row for \"$area\": | $area | 🟢 High / 🟡 Medium / ⚪ Low / — None | how | (tools/pr-body-template.md)" >&2; exit 2; }
  done
  # A PR that changes a screen opens WITH its before/after images (owner, 28 Sep and 13 Oct 2026; #774 opened without them, 14 Oct): an image in the body, or a line
  # "No screenshots: <why>" when nothing visible changed (an API route in site/src). Screens: the app's window, the site's pages, the extension's pages and styles.
  screens="$(git diff --name-only "$base"..HEAD | grep -E '^(desktop/renderer/|site/src/|site/public/)|^(desktop|extension)/.*\.(html|css)$' | head -3 | paste -sd ' ' - || true)"
  if [ -n "$screens" ] && ! grep -qiE '!\[[^]]*\]\([^)]+\.(png|jpe?g|gif|webp)\)|<img |^No screenshots: .{8,}' "$summary"; then
    echo "pr-body: this PR changes a screen ($screens) but the summary has no before/after image: add them (memory feedback-ui-pr-before-after: tag pr-assets-<branch>), or a line \"No screenshots: <why>\" when nothing visible changed" >&2; exit 2
  fi
fi
# Laid out for GitHub (owner, 15 Oct 2026: headings, sizes, spacing; a run id is a link): tools/pr-body-format.py, the repo from the origin remote.
repo="$(git remote get-url origin 2>/dev/null | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##' | grep -E '^[^/ ]+/[^/ ]+$' || true)"
if [ -n "$summary" ] && [ -s "$summary" ]; then python3 "$(dirname "$0")/pr-body-format.py" "$repo" < "$summary"; else printf '### %s\n' "$(git log --reverse --format=%s "$base"..HEAD | head -n 1)"; fi
printf '\n'
facts=""
fact() {   # emoji, label, trailer key
  local value; value="$(git log --format="%(trailers:key=$3,valueonly)" "$base"..HEAD | grep -v '^$' | sort -u | paste -sd ';' - | sed 's/;/; /g' || true)"
  [ -n "$value" ] && facts+="| $1 $2 | ${value//|/\\|} |"$'\n'
  return 0
}
fact '🎯' 'Pool row' Pool-row; fact '🪜' 'Rung' Rung; fact '🧪' 'Fixture' Fixture; fact '🔧' 'Fix of' Fix-commit; fact '📌' 'Pins' Recorded-pins
fact '📼' 'No recorded page' Recorded-unneeded; fact '🐞' 'E2E issue' E2E-issue
if [ -n "$facts" ]; then printf '\n### 🧾 Facts\n\n| | |\n|---|---|\n%s\n' "$facts"; fi
printf '\n---\n\n'
count="$(git rev-list --count "$base"..HEAD)"
printf '<details><summary>📄 The commit message%s</summary>\n\n' "$([ "$count" -gt 1 ] && echo "s ($count)")"
git log --reverse --format='#### %s%n%n%b' "$base"..HEAD | grep -v '^Co-Authored-By:'
printf '</details>\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n'
