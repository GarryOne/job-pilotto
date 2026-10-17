#!/usr/bin/env bash
# The one required check that collects every other PR check (owner, 14 Oct 2026: a PR was mergeable while "replay gate" and the suites still ran; the workflows
# start by `on: paths:`, and a workflow paths can skip cannot be required itself). pr-gate.yml "All checks passed" starts on EVERY pull request. No path logic:
# it waits APPEAR_S (90 s) for the workflows GitHub starts, then until every workflow run of this commit (other than its own) has ended; green only when each ended
# success or skipped. A CANCELLED run of a workflow is superseded, and ignored, when a NEWER run of the same workflow on the same commit succeeded (an edit of the PR
# description starts the description check again and cancels the older run, 16 Oct 2026); a failure is never ignored, nor a cancelled run with no newer success.
# This run itself counts as a newer success of its own workflow (17 Oct 2026: an older run of "CI · Pull request" cancelled by this one, concurrency, was listed as not green and turned #1162 red).
# A re-run of a red workflow: re-run this job too.
#   tools/all-checks-green.sh <owner/repo> <the PR's head sha> [own run id]      Guard: tests/test_all_checks_green.py
set -u
repo="${1:?usage: tools/all-checks-green.sh <owner/repo> <head sha> [own run id]}" sha="${2:?head sha}" own="${3:-${GITHUB_RUN_ID:-}}"
appear="${APPEAR_S:-60}" wait_min="${WAIT_MIN:-60}" poll="${POLL_S:-10}"
runs() { gh run list -R "$repo" --commit "$sha" -L 100 --json databaseId,workflowName,status,conclusion,event,createdAt \
  -q ".[] | select(.event == \"pull_request\") | \"\(if (.databaseId | tostring) == \"$own\" then \"own\" else .status end)\t\(.conclusion // \"-\")\t\(.workflowName)\t\(.createdAt // \"\")\"" 2>/dev/null || true; }
# The workflows GitHub starts appear within seconds of the push: counted from the commit's FIRST run, not from this job's start (it starts after
# its own setup and fast checks), so a late gate never sleeps again (owner, 17 Oct 2026: a green PR's gate sat ~2 min on a fixed 90 s sleep).
epoch() { date -u -d "$1" +%s 2>/dev/null || date -u -j -f %Y-%m-%dT%H:%M:%SZ "$1" +%s 2>/dev/null || echo 0; }
first_run() { cut -f4 <<<"$1" | grep . | sort | head -n 1; }
deadline=$(( $(date +%s) + wait_min * 60 ))
# Another running copy of this gate's own workflow on the same commit (the code run and the description-edit run have separate concurrency groups) is never
# waited for: each waited for the other until the deadline and both went red (17 Oct 2026, #1192-#1194 held 60 min). The other copy judges the same runs itself.
waiting() { awk -F'\t' '$1 == "own" { gate = $3 } { s[NR] = $1; w[NR] = $3 } END { for (i = 1; i <= NR; i++) if (s[i] != "completed" && s[i] != "own" && w[i] != gate) print w[i] }' <<<"$1"; }
while :; do
  list="$(runs)"
  pending="$(waiting "$list" | grep -c . || true)"
  first="$(first_run "$list")"; settled=$(( $( [ -n "$first" ] && epoch "$first" || date +%s ) + appear ))
  [ "$pending" = 0 ] && [ "$(date +%s)" -ge "$settled" ] && break
  if [ "$(date +%s)" -gt "$deadline" ]; then echo "::error::$pending workflow(s) still running after ${wait_min} min:"; waiting "$list"; exit 1; fi
  sleep "$poll"
done
bad="$(grep . <<<"$list" | awk -F'\t' '
  { c[NR] = ($1 == "own") ? "success" : $2; w[NR] = $3; t[NR] = $4; o[NR] = ($1 == "own"); s[NR] = $1; if ($1 == "own") gate = $3 }
  END { for (i = 1; i <= NR; i++) {
          if (o[i]) continue
          # Any other copy of this gate (running, cancelled or failed): it only repeats the judgment of this run on the same commit. Two copies that
          # counted each other failed each other, and re-runs could never clear it (#1199, 17 Oct 2026).
          if (w[i] == gate) continue
          if (c[i] == "success" || c[i] == "skipped") continue
          gone = 0
          if (c[i] == "cancelled" && t[i] != "") for (j = 1; j <= NR; j++) if (w[j] == w[i] && c[j] == "success" && t[j] > t[i]) { gone = 1; break }
          if (!gone) print w[i] " (" c[i] ")" } }' || true)"
total="$(grep -v '^own' <<<"$list" | grep -c . || true)"
if [ -z "$bad" ]; then echo "All checks passed: ${total} workflow(s) of ${sha:0:7} ended green"; exit 0; fi
echo "::error::not green:"; echo "$bad"; exit 1
