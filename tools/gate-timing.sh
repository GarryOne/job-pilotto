#!/usr/bin/env bash
# Times every step of the push gate: `source tools/gate-timing.sh` then `timed <name> <command...>` runs the command (stdout and stderr untouched,
# its exit code kept) and records "<seconds> <exit> <name>"; `gate_summary` prints the slowest steps of this run to stderr and appends the run
# to <git common dir>/gate-timing.log (shared by every worktree, never committed). Owner: landing-speed (11 Oct 2026, spec faster-fixes §6).
# GATE_TIMING=0 turns it off (the command still runs). Guarded by tests/test_gate_timing.py.
GATE_STEPS=""

gate_timing_start() {
  [ "${GATE_TIMING:-1}" = 0 ] && return 0
  GATE_STEPS="$(mktemp)"; GATE_STARTED=$SECONDS
}

timed() {  # name, command...
  local name="$1" began=$SECONDS code=0; shift
  "$@" || code=$?
  [ -n "$GATE_STEPS" ] && printf '%s %s %s\n' "$((SECONDS - began))" "$code" "$name" >>"$GATE_STEPS"
  return "$code"
}

gate_summary() {  # label: one line per step, slowest first (top 6), and the whole run appended to the shared log
  [ -n "$GATE_STEPS" ] && [ -s "$GATE_STEPS" ] || { rm -f "$GATE_STEPS"; return 0; }
  local label="${1:-push gate}" total=$((SECONDS - GATE_STARTED)) common log
  echo "gate-timing: $label took ${total}s; slowest steps:" >&2
  sort -rn "$GATE_STEPS" | head -6 | awk '{ s=$1; c=$2; $1=""; $2=""; sub(/^  /, ""); printf "  %4ds  %s%s\n", s, $0, (c != 0 ? "  (exit " c ")" : "") }' >&2
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || common=""
  if [ -n "$common" ] && [ -d "$common" ]; then
    log="$common/gate-timing.log"
    { echo "# $(date -u +%FT%TZ) $label total=${total}s branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"; cat "$GATE_STEPS"; } >>"$log" 2>/dev/null || true
  fi
  rm -f "$GATE_STEPS"; GATE_STEPS=""
}
