#!/usr/bin/env bash
# The push gate's wall-clock budget (owner, 11 Oct 2026: every local check before a push takes under 60 s). `source tools/gate-watchdog.sh`.
#   gate_budget            seconds the heavy steps may run (JP_GATE_BUDGET, default 55); 0 = no watchdog (JP_GATE_FULL=1 or PUSH_FULL=1: the old full run)
#   gate_wait_budget PID:CODEFILE...  wait for those background steps (a step is done when its CODEFILE, the exit code it writes, exists); at the budget, kill the still-running DEFERRABLE ones (GATE_DEFERRABLE: " pid pid ") and list them in
#                          GATE_DEFERRED; a step that is not deferrable (lint, the affected unit tests) is always waited out
#   gate_was_deferred PID  is that step one the watchdog stopped?
# A deferred step is never a failure and never silent: the hook says "DEFERRED TO CI" with its name, and CI runs it (build.yml, recorded-pages.yml).
# Guarded by tests/test_pre_push_check.py. Uses $SECONDS: the budget counts from the start of the hook.
GATE_DEFERRABLE=""; GATE_DEFERRED=""

gate_budget() {
  case "${JP_GATE_FULL:-0}${PUSH_FULL_RUN:-0}" in *1*) echo 0; return ;; esac
  echo "${JP_GATE_BUDGET:-55}"
}

gate_kill_tree() {  # a step and everything it started
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do gate_kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}

gate_was_deferred() { case "$GATE_DEFERRED" in *" $1 "*) return 0 ;; esac; return 1; }

gate_wait_budget() {
  local budget alive pid pair; budget="$(gate_budget)"
  while :; do
    alive=""
    for pair in "$@"; do [ -f "${pair#*:}" ] || { kill -0 "${pair%%:*}" 2>/dev/null && alive="$alive ${pair%%:*}"; }; done
    [ -n "$alive" ] || return 0
    if [ "$budget" -gt 0 ] && [ "$SECONDS" -ge "$budget" ]; then
      for pid in $alive; do
        case "$GATE_DEFERRABLE" in *" $pid "*) gate_kill_tree "$pid"; GATE_DEFERRED="$GATE_DEFERRED $pid " ;; esac
      done
      budget=0   # what is left is not deferrable: wait it out
    fi
    sleep 0.5
  done
}
