#!/usr/bin/env bash
# The one required check that collects every other PR check (owner, 14 Oct 2026: a PR was mergeable while "replay gate" and the suites still ran; the workflows
# start by `on: paths:`, and a workflow paths can skip cannot be required itself). pr-gate.yml "All checks passed" starts on EVERY pull request. No path logic:
# it waits APPEAR_S (90 s) for the workflows GitHub starts, then until every workflow run of this commit (other than its own) has ended; green only when each ended
# success or skipped. A CANCELLED run of a workflow is superseded, and ignored, when a NEWER run of the same workflow on the same commit succeeded (an edit of the PR
# description starts the description check again and cancels the older run, 16 Oct 2026); a failure is never ignored, nor a cancelled run with no newer success.
# A re-run of a red workflow: re-run this job too.
#   tools/all-checks-green.sh <owner/repo> <the PR's head sha> [own run id]      Guard: tests/test_all_checks_green.py
set -u
repo="${1:?usage: tools/all-checks-green.sh <owner/repo> <head sha> [own run id]}" sha="${2:?head sha}" own="${3:-${GITHUB_RUN_ID:-}}"
appear="${APPEAR_S:-90}" wait_min="${WAIT_MIN:-60}" poll="${POLL_S:-20}"
runs() { gh run list -R "$repo" --commit "$sha" -L 100 --json databaseId,workflowName,status,conclusion,event,createdAt \
  -q ".[] | select(.event == \"pull_request\" and (.databaseId | tostring) != \"$own\") | \"\(.status)\t\(.conclusion // \"-\")\t\(.workflowName)\t\(.createdAt // \"\")\"" 2>/dev/null || true; }
sleep "$appear"
deadline=$(( $(date +%s) + wait_min * 60 ))
while :; do
  list="$(runs)"
  pending="$(grep -v '^completed' <<<"$list" | grep -c . || true)"
  [ "$pending" = 0 ] && break
  if [ "$(date +%s)" -gt "$deadline" ]; then echo "::error::$pending workflow(s) still running after ${wait_min} min:"; grep -v '^completed' <<<"$list" | cut -f3; exit 1; fi
  sleep "$poll"
done
bad="$(grep . <<<"$list" | awk -F'\t' '
  { c[NR] = $2; w[NR] = $3; t[NR] = $4 }
  END { for (i = 1; i <= NR; i++) {
          if (c[i] == "success" || c[i] == "skipped") continue
          gone = 0
          if (c[i] == "cancelled" && t[i] != "") for (j = 1; j <= NR; j++) if (w[j] == w[i] && c[j] == "success" && t[j] > t[i]) { gone = 1; break }
          if (!gone) print w[i] " (" c[i] ")" } }' || true)"
total="$(grep -c . <<<"$list" || true)"
if [ -z "$bad" ]; then echo "All checks passed: ${total} workflow(s) of ${sha:0:7} ended green"; exit 0; fi
echo "::error::not green:"; echo "$bad"; exit 1
