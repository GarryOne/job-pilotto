#!/usr/bin/env bash
# Is main red? One answer for the push hook, ship.sh and tools/revert-red.sh. Owner: ship-speed (11 Oct 2026). Guarded by tests/test_red_main.py.
#   bash tools/red-main.sh        prints  green <sha>  |  red|<sha>|<workflow>|<run url>|<completed-at>|<run id>  |  unknown
#                                 exit 1 only for red; no gh, no network or no origin/main is "unknown" (exit 0): a missing answer never blocks a push
# Main's state is decided by the NEWEST commit of origin/main (last 20) that has a finished verdict: its `CI · Tests` and `CI · Recorded pages` runs both completed with success = green; any completed
# failure, or a run still in flight with a failed job = red. A commit whose runs are still going (a fix in flight) proves nothing yet and is skipped, so main stays red until a later commit's run is green
# (11 Oct 2026: the old "a fix is building" exemption let four landings through on top of a fix attempt that itself ended red). A run cancelled or timed out with no failed job is skipped and re-run.
# RED_MAIN_REPO=<folder> reads another clone; RED_MAIN_RUNS=<n> how many runs to ask gh for (default 60).
# The workflows whose result makes main red (names as in `name:` of .github/workflows/*.yml): the one place. Every other workflow is classified as ignored, with its reason, in tests/test_red_main.py:
# adding a workflow there is a conscious choice (that test fails for an unclassified one).
RED_WORKFLOWS=("CI · Tests" "CI · Recorded pages")
repo="${RED_MAIN_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
names_json="$(printf '%s\n' "${RED_WORKFLOWS[@]}" | jq -R . | jq -sc .)"
command -v gh >/dev/null && command -v jq >/dev/null || { echo unknown; exit 0; }
git -C "$repo" rev-parse -q --verify origin/main >/dev/null || { echo unknown; exit 0; }
runs="$(cd "$repo" && gh run list --branch main -L "${RED_MAIN_RUNS:-60}" --json workflowName,headSha,status,conclusion,databaseId,updatedAt,url 2>/dev/null)" && [ -n "$runs" ] || { echo unknown; exit 0; }
pick='[.[] | select(.headSha == $s and (.workflowName as $w | any($names[]; . as $n | $w | startswith($n))))]'
for sha in $(git -C "$repo" rev-list -n 20 origin/main 2>/dev/null); do
  mine="$(jq -c --arg s "$sha" --argjson names "$names_json" "$pick" <<<"$runs" 2>/dev/null)"
  [ -n "$mine" ] && [ "$mine" != "[]" ] || continue
  # a finished failure (a real failed job) or an unfinished run that already has a failed job: red
  for row in $(jq -r '.[] | select((.status == "completed" and (.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")) or .status != "completed") | "\(.databaseId)|\(.status)|\(.conclusion)"' <<<"$mine"); do
    id="${row%%|*}"; rest="${row#*|}"; status="${rest%%|*}"
    failed="$(cd "$repo" && gh run view "$id" --json jobs --jq '[.jobs[] | select(.conclusion == "failure")] | length' 2>/dev/null)"
    if [ "${failed:-0}" -gt 0 ] 2>/dev/null; then
      jq -r --arg id "$id" '.[] | select((.databaseId | tostring) == $id) | "red|\(.headSha[0:7])|\(.workflowName)|\(.url)|\(.updatedAt)|\(.databaseId)"' <<<"$mine"; exit 1
    fi
    if [ "$status" = completed ]; then (cd "$repo" && gh run rerun "$id" --failed >/dev/null 2>&1) || true; fi   # cancelled or never started: re-run, it blocks nobody
  done
  # every run of this commit finished green: main is green here; anything else (still going, or only cancelled) proves nothing: look further back
  if [ "$(jq -r --argjson names "$names_json" '. as $r | all($r[]; .status == "completed" and .conclusion == "success") and all($names[]; . as $n | any($r[]; .workflowName | startswith($n)))' <<<"$mine")" = true ]; then echo "green ${sha:0:7}"; exit 0; fi
done
echo unknown; exit 0
