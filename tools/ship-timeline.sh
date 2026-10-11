# Source it from tools/ship.sh: one append-only line per landing attempt in <git common dir>/ship-timeline.log (never overwritten, unlike the per-topic ship log). Owner: ship-speed (11 Oct 2026).
# Read it with `node tools/landing-report.mjs <branch>` (or --last N). Guarded by tests/test_ship_timeline.py. GATE_TIMING=0 writes nothing.
# Line: space-separated key=value. ts_start ts_end first_commit (the oldest commit on the branch, by author date) branch session result (DONE:<sha> | FAILED:<why>) total
# queue rebase checks wf_wait push (seconds between ship's own steps) refused rechecked skipped (refusals, re-checks run, re-checks skipped) gate_steps (name:seconds,...).
TL_MARKS=""
timeline_begin() {  # log-file
  TL_LOG="$1"; TL_START=$SECONDS; TL_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; TL_LINES="$(wc -l <"$1" 2>/dev/null | tr -d ' ')"
  TL_FIRST="$(git log origin/main..HEAD --format=%aI 2>/dev/null | tail -n 1)"
}
timeline_mark() { TL_MARKS="$TL_MARKS$((SECONDS - TL_START))|$1"$'\n'; }
timeline_write() {  # exit-code: reads $finished, $sha, $branch
  [ "${GATE_TIMING:-1}" = 0 ] && return 0
  local code="$1" result common total="$((SECONDS - TL_START))" part new
  if [ "$code" -ne 0 ]; then result="FAILED:exit$code"; elif [ -n "$finished" ]; then result="DONE:${sha:-nothing}"; else result="FAILED:ended-early"; fi
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  [ -d "$common" ] || return 0
  new="$(tail -n +"$((${TL_LINES:-0} + 1))" "$TL_LOG" 2>/dev/null)"
  part="$(printf '%s' "$TL_MARKS" | awk -F'|' -v total="$total" '
    function at(p,   i) { for (i = 1; i <= n; i++) if (index(m[i], p) == 1) return t[i]; return -1 }
    { n++; t[n] = $1; m[n] = substr($0, length($1) + 2) }
    END {
      q = at("queueing"); r = at("rebasing"); c = at("running the push checks"); p = at("the push checks passed"); w = at("pushing to main")
      printf "queue=%d rebase=%d checks=%d wf_wait=%d push=%d", (q >= 0 && r >= 0 ? r - q : 0), (r >= 0 && c >= 0 ? c - r : 0), (c >= 0 && p >= 0 ? p - c : 0), (p >= 0 && w >= 0 ? w - p : 0), (w >= 0 ? total - w : 0)
    }')"
  printf 'ts_start=%s ts_end=%s first_commit=%s branch=%s session=%s result=%s total=%ss %s refused=%s rechecked=%s skipped=%s gate_steps=%s\n' \
    "$TL_ISO" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${TL_FIRST:-?}" "$branch" "$(session_name 2>/dev/null || echo ?)" "$result" "$total" \
    "$(printf '%s' "$part" | sed -E 's/=([0-9]+)/=\1s/g')" \
    "$(printf '%s\n' "$new" | grep -c 'push rejected')" "$(printf '%s\n' "$new" | grep -c 'the push checks (.*again, on the new main')" "$(printf '%s\n' "$new" | grep -c 'not re-running the checks')" \
    "$(printf '%s\n' "$new" | sed -nE 's/^ +([0-9]+)s  ([a-zA-Z0-9]+)( .*)?$/\2:\1/p' | paste -sd, - | grep . || echo none)" >>"$common/ship-timeline.log" 2>/dev/null || true
}
