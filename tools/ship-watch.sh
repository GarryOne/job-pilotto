#!/usr/bin/env bash
# Watches a PR that tools/ship.sh left at `ship: REVIEW` and appends the ending to ship's log: `ship: MERGED #n <sha>`, `ship: CLOSED #n (unmerged)`,
# `ship: RED #n <check>` (a required check turned red after REVIEW; it keeps watching) or `ship: WATCH ENDED #n (still open)` after the cap. No AI, only gh.
#   tools/ship-watch.sh <n> <log> <pidfile>      SHIP_WATCH_POLL=<s> between looks (default 60)   SHIP_WATCH_CAP=<s> give up after (default 172800 = 48 h)
# Started detached by tools/ship.sh; a second ship of the same branch replaces the old watcher through the pid file (18 Oct 2026: the owner merges by hand and
# sessions only learned of it when told). Guard: tests/test_ship_watch.py.
set -u
n="${1:?usage: ship-watch.sh <n> <log> <pidfile>}"; log="${2:?}"; pidfile="${3:?}"
poll="${SHIP_WATCH_POLL:-60}"; cap="${SHIP_WATCH_CAP:-172800}"
old="$(cat "$pidfile" 2>/dev/null || true)"
[ -z "$old" ] || [ "$old" = "$$" ] || kill "$old" 2>/dev/null || true   # one watcher per branch
echo $$ > "$pidfile"
trap '[ "$(cat "$pidfile" 2>/dev/null)" != "$$" ] || rm -f "$pidfile"' EXIT
say() { echo "ship: $*" >> "$log"; }
waited=0; red=""
while :; do
  view="$(gh pr view "$n" --json state,mergeCommit 2>/dev/null)" || view=""
  state="$(jq -r '.state // empty' <<<"$view" 2>/dev/null)"
  case "$state" in
    MERGED) say "MERGED #$n $(jq -r '.mergeCommit.oid // empty' <<<"$view" | cut -c1-7)"; exit 0 ;;
    CLOSED) say "CLOSED #$n (unmerged)"; exit 0 ;;
  esac
  if [ -n "$state" ]; then
    now="$(gh pr checks "$n" --json name,bucket 2>/dev/null | jq -r '[.[]? | select(.bucket == "fail") | .name] | first // empty' 2>/dev/null)" || now=""
    [ "$now" = "$red" ] || { [ -z "$now" ] || say "RED #$n $now"; red="$now"; }   # once per red check; green again re-arms it
  fi
  [ "$waited" -lt "$cap" ] || { say "WATCH ENDED #$n (still open)"; exit 0; }
  sleep "$poll"; waited=$((waited + poll + 1))
done
