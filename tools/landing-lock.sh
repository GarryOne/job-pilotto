#!/usr/bin/env bash
# One landing at a time on this Mac, in arrival order (tools/ship.sh sources this): `landing_acquire <label>` waits until no older live landing is ahead
# of it (and says who), `landing_release` leaves the queue (ship.sh's exit trap). Queue = tickets in <git common dir>/landing-queue/<nanoseconds>-<pid>,
# each holding "<pid> <label>"; a ticket whose pid is gone is dropped. The next landing then rebases once, on a main that already has the one before it.
#   SHIP_LANDING_LOCK=0   no queue          SHIP_LANDING_WAIT=<s>   longest wait before landing anyway (default 1800, said in the log)
# Owner: landing-speed (11 Oct 2026, spec faster-fixes §6). Guarded by tests/test_landing_lock.py.
LANDING_TICKET=""

landing_acquire() {  # label
  [ "${SHIP_LANDING_LOCK:-1}" = 0 ] && return 0
  local common dir began told=0 wait_max="${SHIP_LANDING_WAIT:-1800}" ahead
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  dir="$common/landing-queue"; mkdir -p "$dir" || return 0
  LANDING_TICKET="$dir/$(python3 -c 'import time; print(time.time_ns())')-$$"
  echo "$$ $1" >"$LANDING_TICKET"
  began="$(date +%s)"
  while :; do
    ahead=""
    for ticket in $(ls "$dir" 2>/dev/null | sort); do
      [ "$dir/$ticket" = "$LANDING_TICKET" ] && break
      pid="$(cut -d' ' -f1 "$dir/$ticket" 2>/dev/null)"
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then ahead="$ahead${ahead:+, }$(cut -d' ' -f2- "$dir/$ticket") (pid $pid)"; else rm -f "$dir/$ticket"; fi
    done
    [ -z "$ahead" ] && break
    if [ $(( $(date +%s) - began )) -ge "$wait_max" ]; then echo "landing-lock: waited ${wait_max}s behind $ahead: landing anyway" >&2; return 0; fi
    [ "$told" = 0 ] || [ $(( ($(date +%s) - began) % 30 )) -lt 3 ] && echo "landing-lock: waiting for the landing of $ahead (SHIP_LANDING_LOCK=0 skips this)" >&2
    told=1; sleep 2
  done
  [ "$told" = 1 ] && echo "landing-lock: my turn after $(( $(date +%s) - began ))s" >&2
  return 0
}

landing_release() { [ -n "$LANDING_TICKET" ] && rm -f "$LANDING_TICKET"; LANDING_TICKET=""; return 0; }
