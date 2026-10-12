#!/usr/bin/env bash
# The description of a PR that tools/ship.sh opens (owner, 12 Oct 2026: "I have 2-5 seconds to look at it; not an essay"). Guard: tests/test_pr_body.py.
#   tools/pr-body.sh <base> [--body=<file>]   prints the body for the commits <base>..HEAD
# Top: the session's 5-second summary (--body=<file>: a verdict line, a few short bullets or a before/after table), else the first subject.
# Then a table of the trailers' facts (pool row, rung, fixture, ...). The commit messages are folded in a <details>, never above it.
set -euo pipefail
base="${1:?usage: tools/pr-body.sh <base> [--body=<file>]}"; summary=""
for arg in "${@:2}"; do case "$arg" in --body=*) summary="${arg#--body=}" ;; esac; done
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
