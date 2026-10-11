# Source it from tools/ship.sh: while main is red, every landing except the fix waits for it; after 5 minutes without a claim (15 with one) it says loudly to revert. Owner: ship-speed (11 Oct 2026).
# Guarded by tests/test_ship_red.py. The decision is tools/red-main.sh (see there); the clock is the completion time of the first red run.
#   SHIP_IGNORE_RED=1       do not wait (only with the owner's OK)          SHIP_RED_LIMIT=<s>   seconds red before a revert is advised (default 300)
#   SHIP_RED_CLAIMED_LIMIT=<s>   the same when a session claimed the fix (default 900)          SHIP_RED_POLL=<s>   seconds between looks (default 30)
ship_red_gate() {  # phase: said in the line ("before the checks", "before the push")
  [ -n "${SHIP_IGNORE_RED:-}" ] && return 0
  case "$flags" in *CI_RED_OK=1*) return 0 ;; esac   # the fix itself never waits
  [ -f "$here/tools/red-main.sh" ] || return 0
  local state bad workflow url finished run_id finished_at age claim limit counted="" said=0
  while :; do
    if [ -z "$counted" ]; then state="$(bash "$here/tools/red-main.sh" track --waiting)" || true; else state="$(bash "$here/tools/red-main.sh" track)" || true; fi
    case "$state" in red*) ;; *) [ "$said" = 1 ] && step "main is green again (${state#green }): going on"; return 0 ;; esac
    counted=1
    IFS="|" read -r _ bad workflow url finished run_id <<<"$state"
    finished_at="$(python3 -c 'import sys,datetime; print(int(datetime.datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")).timestamp()))' "$finished" 2>/dev/null || date +%s)"
    age=$(( $(date +%s) - finished_at )); claim="$(bash "$here/tools/red-main.sh" claim-of "$bad")" || true
    limit="${SHIP_RED_LIMIT:-300}"; [ -n "$claim" ] && limit="${SHIP_RED_CLAIMED_LIMIT:-900}"
    if [ "$age" -ge "$limit" ]; then
      {
        echo "ship: RED MAIN FOR $(( age / 60 )) MIN $(( age % 60 )) s at $bad ($workflow, $url), written by $(git -C "$here" log -1 --format='%an: "%s"' "$bad" 2>/dev/null || echo '?'):"
        echo "ship: nobody has landed a fix within $(( limit / 60 )) min$([ -n "$claim" ] && echo " ($claim claimed it)"). Revert it now: tools/revert-red.sh $bad   (reverts that commit and ships it with --fix)."
        echo "ship: or claim the fix (extends the limit to 15 min, once): tools/red-main.sh claim $bad --session <your session name>. Then run this landing again."
      } >&2
      exit 3
    fi
    step "main is red at $bad ($workflow, ${age}s ago), ${claim:-nobody} ${claim:+is fixing it, waits up to 15 min}${claim:-has claimed it; a revert is advised after $(( limit / 60 )) min}: waiting for the fix, $1 (SHIP_IGNORE_RED=1 only with the owner's OK)"
    said=1
    sleep "${SHIP_RED_POLL:-30}"
  done
}
