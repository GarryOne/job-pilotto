#!/usr/bin/env bash
# Is main red? One answer for the push hook, ship.sh and tools/revert-red.sh. Owner: ship-speed (11 Oct 2026). Guarded by tests/test_red_main.py.
#   bash tools/red-main.sh        prints  green <sha>  |  red|<sha>|<workflow>|<run url>|<completed-at>|<run id>  |  unknown
#                                 exit 1 only for red; no gh, no network or no origin/main is "unknown" (exit 0): a missing answer never blocks a push
# Main's state is decided by the NEWEST commit of origin/main (last 20) that has a finished verdict: its `CI · Tests` and `CI · Recorded pages` runs both completed with success = green; any completed
# failure, or a run still in flight with a failed job = red. A commit whose runs are still going (a fix in flight) proves nothing yet and is skipped, so main stays red until a later commit's run is green
# (11 Oct 2026: the old "a fix is building" exemption let four landings through on top of a fix attempt that itself ended red). A run cancelled or timed out with no failed job is skipped and re-run.
# Other forms (11 Oct 2026, the owner: a red main must be fixed within 5 minutes, 15 with a claim):
#   red-main.sh track                  like status, and keeps the bookkeeping of a red period in <git common dir>/red-main/ (start = completion of the first red run, cause, who claimed it, how many
#                                      landings waited); the first green after it writes one line to gate-timing.log: "red-main start=.. cause=.. sha=.. claim=.. fix=.. minutes=N waited=K"
#   red-main.sh track --waiting        the same, and counts one more landing that waits for the fix
#   red-main.sh claim <sha> --session <name>   "I am fixing it": logged, shown in every waiting ship.sh line, extends the 5 minute limit to 15 (once)
#   red-main.sh claim-of <sha>         the session that claimed it, or nothing
# RED_MAIN_REPO=<folder> reads another clone; RED_MAIN_RUNS=<n> how many runs to ask gh for (default 60).
# The workflows whose result makes main red (names as in `name:` of .github/workflows/*.yml): the one place. Every other workflow is classified as ignored, with its reason, in tests/test_red_main.py:
# adding a workflow there is a conscious choice (that test fails for an unclassified one).
RED_WORKFLOWS=("CI · Tests" "CI · Recorded pages")
names_json="$(printf '%s\n' "${RED_WORKFLOWS[@]}" | jq -R . | jq -sc .)"
repo="${RED_MAIN_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
red_status() {
  command -v gh >/dev/null && command -v jq >/dev/null || { echo unknown; return 0; }
  git -C "$repo" rev-parse -q --verify origin/main >/dev/null || { echo unknown; return 0; }
  runs="$(cd "$repo" && gh run list --branch main -L "${RED_MAIN_RUNS:-60}" --json workflowName,headSha,status,conclusion,databaseId,updatedAt,url 2>/dev/null)" && [ -n "$runs" ] || { echo unknown; return 0; }
  pick='[.[] | select(.headSha == $s and (.workflowName as $w | any($names[]; . as $n | $w | startswith($n))))]'
  for sha in $(git -C "$repo" rev-list -n 20 origin/main 2>/dev/null); do
    mine="$(jq -c --arg s "$sha" --argjson names "$names_json" "$pick" <<<"$runs" 2>/dev/null)"
    [ -n "$mine" ] && [ "$mine" != "[]" ] || continue
    # a finished failure (a real failed job) or an unfinished run that already has a failed job: red
    for row in $(jq -r '.[] | select((.status == "completed" and (.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")) or .status != "completed") | "\(.databaseId)|\(.status)|\(.conclusion)"' <<<"$mine"); do
      id="${row%%|*}"; rest="${row#*|}"; status="${rest%%|*}"
      failed="$(cd "$repo" && gh run view "$id" --json jobs --jq '[.jobs[] | select(.conclusion == "failure")] | length' 2>/dev/null)"
      if [ "${failed:-0}" -gt 0 ] 2>/dev/null; then
        jq -r --arg id "$id" '.[] | select((.databaseId | tostring) == $id) | "red|\(.headSha[0:7])|\(.workflowName)|\(.url)|\(.updatedAt)|\(.databaseId)"' <<<"$mine"; return 1
      fi
      if [ "$status" = completed ]; then (cd "$repo" && gh run rerun "$id" --failed >/dev/null 2>&1) || true; fi   # cancelled or never started: re-run, it blocks nobody
    done
    # every run of this commit finished green: main is green here; anything else (still going, or only cancelled) proves nothing: look further back
    if [ "$(jq -r --argjson names "$names_json" '. as $r | all($r[]; .status == "completed" and .conclusion == "success") and all($names[]; . as $n | any($r[]; .workflowName | startswith($n)))' <<<"$mine")" = true ]; then echo "green ${sha:0:7}"; return 0; fi
  done
  echo unknown; return 0
}

common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; dir="$common/red-main"
iso_epoch() { python3 -c 'import sys,datetime; print(int(datetime.datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")).timestamp()))' "$1" 2>/dev/null; }
timing_log() { [ "${GATE_TIMING:-1}" = 0 ] || [ -z "$common" ] || echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >>"$common/gate-timing.log" 2>/dev/null || true; }
case "${1:-status}" in
  claim)
    sha="${2:?usage: red-main.sh claim <sha> --session <name>}"; sha="${sha:0:7}"; session="?"; [ "${3:-}" = --session ] && session="${4:-?}"
    mkdir -p "$dir"; echo "$session" >"$dir/claim-$sha"; timing_log "red-main claim sha=$sha session=$session"; echo "claimed $sha for $session" ;;
  claim-of) [ -f "$dir/claim-${2:0:7}" ] && cat "$dir/claim-${2:0:7}" ;;
  track)
    state="$(red_status)"; code=$?; echo "$state"
    case "$state" in
      red*) IFS="|" read -r _ bad workflow url finished run_id <<<"$state"; mkdir -p "$dir"
            if [ ! -f "$dir/period" ]; then printf 'start=%s\ncause=%s\nsha=%s\nwaited=0\n' "$finished" "$workflow" "$bad" >"$dir/period"; timing_log "red-main begins sha=$bad cause=$(echo "$workflow" | tr ' ' _) finished=$finished"; fi
            if [ "${2:-}" = --waiting ]; then w="$(sed -n 's/^waited=//p' "$dir/period")"; sed -i.bak "s/^waited=.*/waited=$(( ${w:-0} + 1 ))/" "$dir/period" && rm -f "$dir/period.bak"; fi ;;
      green*) if [ -f "$dir/period" ]; then
                start="$(sed -n 's/^start=//p' "$dir/period")"; bad="$(sed -n 's/^sha=//p' "$dir/period")"; cause="$(sed -n 's/^cause=//p' "$dir/period")"; waited="$(sed -n 's/^waited=//p' "$dir/period")"
                begun="$(iso_epoch "$start")"; minutes="$(python3 -c 'import sys; print(round((float(sys.argv[1]) - float(sys.argv[2])) / 60, 1))' "$(date +%s)" "${begun:-0}" 2>/dev/null)"
                timing_log "red-main ended start=$start cause=$(echo "$cause" | tr ' ' _) sha=$bad claim=$(cat "$dir/claim-$bad" 2>/dev/null || echo -) fix=${state#green } minutes=${minutes:-?} waited=${waited:-0}"
                rm -f "$dir/period"
              fi ;;
    esac
    exit "$code" ;;
  *) red_status; exit $? ;;
esac
