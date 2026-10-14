#!/usr/bin/env bash
# The required stand-in for the PR replay gate (owner, 14 Oct 2026: "replay gate" starts only by `on: paths:` and a workflow paths can skip cannot be required).
# This job starts on EVERY pull request (pr-gate.yml "replay gate status"): no path logic, it only asks GitHub whether the replay gate workflow started for this commit.
#   none within APPEAR_S (90 s): the PR changes no apply-flow code -> passes;   started -> waits up to WAIT_MIN (45) and reports its result: green passes, anything else fails.
#   tools/replay-gate-status.sh <owner/repo> <the PR's head sha>      Guard: tests/test_replay_gate_status.py
set -u
repo="${1:?usage: tools/replay-gate-status.sh <owner/repo> <head sha>}" sha="${2:?head sha}"
appear="${APPEAR_S:-90}" wait_min="${WAIT_MIN:-45}" poll="${POLL_S:-15}"
run_of() { gh run list -R "$repo" --workflow replay-pr.yml --commit "$sha" -L 1 --json databaseId,status,conclusion,url \
  -q '.[0] // empty | "\(.databaseId) \(.status) \(.conclusion // "-") \(.url)"' 2>/dev/null || true; }
start=$(date +%s)
until run="$(run_of)"; [ -n "$run" ]; do
  if [ $(( $(date +%s) - start )) -ge "$appear" ]; then echo "replay gate status: no replay gate run for ${sha:0:7} after ${appear} s (the PR changes no apply-flow code): passes"; exit 0; fi
  sleep "$poll"
done
echo "replay gate status: the replay gate runs for ${sha:0:7}: ${run##* }"
deadline=$(( $(date +%s) + wait_min * 60 ))
while :; do
  read -r _ status conclusion url <<<"$(run_of)"
  [ "$status" = completed ] && break
  if [ "$(date +%s)" -gt "$deadline" ]; then echo "::error::the replay gate did not finish in ${wait_min} min: $url"; exit 1; fi
  sleep "$poll"
done
if [ "$conclusion" = success ]; then echo "replay gate status: green: $url"; exit 0; fi
echo "::error::the replay gate ended '$conclusion': $url (its summary names the rows; re-run this job after re-running the gate)"
exit 1
