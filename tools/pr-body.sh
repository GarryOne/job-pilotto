#!/usr/bin/env bash
# The description of a PR that tools/ship.sh opens (owner, 12 Oct 2026: "I have 2-5 seconds to look at it; not an essay"). Guard: tests/test_pr_body.py.
#   tools/pr-body.sh <base> [--body=<file>]   prints the body for the commits <base>..HEAD
# Top: the session's 5-second summary (--body=<file>: a verdict line, a **Why** line, a few short bullets, a Before/After table, images when a screen changed: refused without them), else the first subject.
# Then a table of the trailers' facts (pool row, rung, fixture, ...). The commit messages are folded in a <details>, never above it.
set -euo pipefail
base="${1:?usage: tools/pr-body.sh <base> [--body=<file>]}"; summary=""
for arg in "${@:2}"; do case "$arg" in --body=*) summary="${arg#--body=}" ;; esac; done
# A summary says WHY (owner, 13 Oct 2026: "explaining why a change is needed: how we decided that we need this. And a before/after"): a "**Why**" line naming the
# incident, measurement or owner request behind it, and a table with Before and After columns. Missing either: refused, saying which.
if [ -n "$summary" ] && [ -s "$summary" ]; then
  grep -qiE '\*\*why\b' "$summary" || { echo 'pr-body: the summary has no "**Why:**" line: say how we decided this is needed (the incident, measurement or owner request behind it)' >&2; exit 2; }
  grep -qiE '^\|.*\bBefore\b.*\|.*\bAfter\b' "$summary" || { echo 'pr-body: the summary has no Before/After table: | | Before | After | with the measured or seen difference' >&2; exit 2; }
  # A PR that changes a screen opens WITH its before/after images (owner, 28 Sep and 13 Oct 2026; #774 opened without them, 14 Oct): an image in the body, or a line
  # "No screenshots: <why>" when nothing visible changed (an API route in site/src). Screens: the app's window, the site's pages, the extension's pages and styles.
  screens="$(git diff --name-only "$base"..HEAD | grep -E '^(desktop/renderer/|site/src/|site/public/)|^(desktop|extension)/.*\.(html|css)$' | head -3 | paste -sd ' ' - || true)"
  if [ -n "$screens" ] && ! grep -qiE '!\[[^]]*\]\([^)]+\.(png|jpe?g|gif|webp)\)|<img |^No screenshots: .{8,}' "$summary"; then
    echo "pr-body: this PR changes a screen ($screens) but the summary has no before/after image: add them (memory feedback-ui-pr-before-after: tag pr-assets-<branch>), or a line \"No screenshots: <why>\" when nothing visible changed" >&2; exit 2
  fi
fi
if [ -n "$summary" ] && [ -s "$summary" ]; then cat "$summary"; else printf '### %s\n' "$(git log --reverse --format=%s "$base"..HEAD | head -n 1)"; fi
printf '\n'
facts=""
fact() {   # emoji, label, trailer key
  local value; value="$(git log --format="%(trailers:key=$3,valueonly)" "$base"..HEAD | grep -v '^$' | sort -u | paste -sd ';' - | sed 's/;/; /g' || true)"
  [ -n "$value" ] && facts+="| $1 $2 | ${value//|/\\|} |"$'\n'
  return 0
}
fact '🎯' 'Pool row' Pool-row; fact '🪜' 'Rung' Rung; fact '🧪' 'Fixture' Fixture; fact '🔧' 'Fix of' Fix-commit; fact '📌' 'Pins' Recorded-pins
fact '📼' 'No recorded page' Recorded-unneeded; fact '🐞' 'E2E issue' E2E-issue
if [ -n "$facts" ]; then printf '| | |\n|---|---|\n%s\n' "$facts"; fi
count="$(git rev-list --count "$base"..HEAD)"
printf '<details><summary>📄 The commit message%s</summary>\n\n' "$([ "$count" -gt 1 ] && echo "s ($count)")"
git log --reverse --format='#### %s%n%n%b' "$base"..HEAD | grep -v '^Co-Authored-By:'
printf '</details>\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n'
