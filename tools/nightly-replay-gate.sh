#!/usr/bin/env bash
# The nightly beta's replay gate (owner, 14 Oct 2026; spec docs/superpowers/specs/2026-10-13-replay-by-network.md "Schedule, gate and alerts"): the commit the nightly
# builds needs a green run of the offline replay (replay-offline.yml). None yet (a merge after the 02:30 run): it starts one and waits for it (~80 min, the beta
# comes later), never builds without it. Prints "pass" or "fail: <why>" on its last line. Used by .github/workflows/desktop.yml (Anything new?).
#   GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA from the runner; REPLAY_GATE_WAIT_MIN (default 110).
set -u
repo=$GITHUB_REPOSITORY sha=$GITHUB_SHA wait_min=${REPLAY_GATE_WAIT_MIN:-110}
latest() { gh run list -R "$repo" --workflow replay-offline.yml --commit "$sha" --limit 5 --json databaseId,status,conclusion \
  --jq 'if length == 0 then "" else (.[0] | "\(.databaseId) \(.status) \(.conclusion // "-")") end' 2>/dev/null || true; }
run=$(latest)
if [ -z "$run" ]; then
  echo "replay gate: no replay run on ${sha::7} yet (a merge after 02:30): starting one and waiting for it" >&2
  gh workflow run replay-offline.yml -R "$repo" --ref main -f scheduled=true >&2 || { echo "fail: could not start the replay"; exit 0; }
fi
deadline=$(( $(date +%s) + wait_min * 60 ))
while :; do
  run=$(latest)
  read -r id status conclusion <<< "${run:-- - -}"
  [ "$status" = completed ] && break
  [ "$(date +%s)" -gt "$deadline" ] && { echo "fail: the replay on ${sha::7} did not finish in ${wait_min} min (run ${id})"; exit 0; }
  sleep 60
done
if [ "$conclusion" = success ]; then echo "pass"; else echo "fail: the replay on ${sha::7} is ${conclusion} (run https://github.com/${repo}/actions/runs/${id})"; fi
