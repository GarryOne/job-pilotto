#!/usr/bin/env bash
# Revert a red commit of main and ship the revert as the fix. Owner: ship-speed (11 Oct 2026). Guarded by tests/test_revert_red.py.
#   tools/revert-red.sh <sha>              checks that main is red at <sha> (tools/red-main.sh), makes a worktree, reverts the commit there, and lands it with tools/ship.sh --fix
#   tools/revert-red.sh <sha> --dry-run    says what it would do, changes nothing (the red check still applies; --force passes it)
#   tools/revert-red.sh <sha> --force      when red-main.sh cannot say (no gh, no network) or says main is not red at <sha>: the caller has looked and is sure
# It sends no message to anyone. A conflict stops it with the worktree kept: resolve it by hand (git revert --continue), then tools/ship.sh --fix there.
# The first session that meets the "RED MAIN FOR 5 MIN" line of tools/ship.sh runs this (AGENTS.md "Red main").
set -euo pipefail
sha="${1:?usage: tools/revert-red.sh <sha> [--dry-run] [--force]}"; shift; force=0; dry=0
for flag in "$@"; do case "$flag" in --force) force=1 ;; --dry-run) dry=1 ;; *) echo "revert-red: unknown flag $flag" >&2; exit 2 ;; esac; done
here="$(cd "$(dirname "$0")/.." && pwd)"
main="$(cd "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
git -C "$main" fetch -q origin
full="$(git -C "$main" rev-parse --verify -q "$sha^{commit}")" || { echo "revert-red: $sha is not a commit of this clone" >&2; exit 2; }
git -C "$main" merge-base --is-ancestor "$full" origin/main || { echo "revert-red: ${full:0:7} is not on origin/main" >&2; exit 2; }
[ "$(( $(git -C "$main" rev-list --parents -n 1 "$full" | wc -w) ))" = 2 ] || { echo "revert-red: ${full:0:7} is a merge commit: revert it by hand (git revert -m 1)" >&2; exit 2; }
state="$(bash "$here/tools/red-main.sh" status 2>/dev/null)" || true
case "$state" in
  red*) IFS="|" read -r _ bad workflow _ _ _ <<<"$state"
        [ "$bad" = "${full:0:7}" ] || [ "$force" = 1 ] || { echo "revert-red: main is red at $bad ($workflow), not at ${full:0:7}. Revert $bad (the commit CI names), or pass --force." >&2; exit 2; } ;;
  *) [ "$force" = 1 ] || { echo "revert-red: main is not red as far as tools/red-main.sh can tell ($state). Pass --force if you have seen the red run yourself." >&2; exit 2; } ;;
esac
subject="$(git -C "$main" log -1 --format=%s "$full")"; author="$(git -C "$main" log -1 --format=%an "$full")"
topic="revert-red-${full:0:7}"
echo "revert-red: reverting ${full:0:7} (\"$subject\" by $author) in .claude/worktrees/$topic and shipping it with --fix"
[ "$dry" = 0 ] || exit 0
tree="$(cd "$main" && sh tools/worktree.sh "$topic" | tail -n 1)"
cd "$tree"
git revert --no-edit -n "$full" || { echo "revert-red: the revert conflicts. The worktree is kept: $tree (resolve, git commit, then tools/ship.sh --fix)" >&2; exit 1; }
msg="$(mktemp)"
{ echo "Revert ${full:0:7}: main was red, no fix in time"
  echo
  echo "Reverts \"$subject\" by $author. Red main rule (AGENTS.md): no fix landed in 5 min."
  echo
  echo "Rung: none: a revert of a red commit"; echo "Fixture: none: a revert of a red commit"; echo "Recorded-unneeded: a revert of a red commit"
} >"$msg"
git commit -q -F "$msg"; rm -f "$msg"
timing="$(git rev-parse --path-format=absolute --git-common-dir)/gate-timing.log"
[ "${GATE_TIMING:-1}" = 0 ] || echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) red-main revert sha=${full:0:7} by=$author" >>"$timing" 2>/dev/null || true
exec bash tools/ship.sh --fix
