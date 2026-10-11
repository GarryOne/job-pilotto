#!/usr/bin/env bash
# One heavy run at a time per Mac: browser suites, recorded replays, real-extension and the e2e harness take this lock; unit tests never do.
#   bash tools/heavy-lock.sh <what> <command...>      waits for the lock (says who holds it), waits while the load is high, runs, frees it, keeps the exit code
# Lock = a directory <TMPDIR>/job-pilotto-heavy/lock holding pid, what, since, cwd; stale when its pid is gone (taken over by an atomic rename).
# First come, first served (11 Oct 2026: the pool's per-site runs re-took a just-freed lock while a replay starved 6+ min): each waiter holds a ticket
# <root>/queue/<nanoseconds>-<pid> ("<pid> <what>") and takes the lock only when no live older ticket is ahead; a dead waiter's ticket is dropped.
# Every wait is logged to <git common dir>/gate-timing.log (JOB_PILOTTO_HEAVY_TIMING_LOG elsewhere, GATE_TIMING=0 off).
# A nested call (a suite started by `npm run all`) sees JP_HEAVY_HELD and runs at once. Escape hatches, all said in the log when used:
#   JOB_PILOTTO_HEAVY=0                 no lock, no load wait
#   JOB_PILOTTO_HEAVY_WAIT=<s>          longest wait for the lock before running anyway (default 1800)
#   JOB_PILOTTO_HEAVY_LOAD=<n>          1-minute load average above which a run waits (default 1.5 x cores); 0 = never wait for load
#   JOB_PILOTTO_HEAVY_LOAD_WAIT=<s>     longest wait for the load to drop before running anyway (default 300)
# Owner: landing-speed (11 Oct 2026, spec faster-fixes §6). Guarded by tests/test_heavy_lock.py.
what="${1:-heavy run}"; shift || true
[ "$#" -gt 0 ] || { echo "usage: heavy-lock.sh <what> <command...>" >&2; exit 2; }
if [ "${JOB_PILOTTO_HEAVY:-1}" = 0 ] || [ -n "${JP_HEAVY_HELD:-}" ]; then exec "$@"; fi

root="${JOB_PILOTTO_HEAVY_DIR:-${TMPDIR:-/tmp}/job-pilotto-heavy}"; lock="$root/lock"
mkdir -p "$root"
say() { echo "heavy-lock: $*" >&2; }
holder() { local pid what since; pid="$(cat "$lock/pid" 2>/dev/null)"; what="$(cat "$lock/what" 2>/dev/null)"; since="$(cat "$lock/since" 2>/dev/null)"
  echo "pid ${pid:-?} (${what:-?}) since $(date -r "${since:-0}" +%T 2>/dev/null || echo ?), $(( $(date +%s) - ${since:-$(date +%s)} ))s ago"; }
stale() {  # the lock's owner is gone (or never wrote its pid within 10 s)
  local pid; pid="$(cat "$lock/pid" 2>/dev/null)"
  if [ -z "$pid" ]; then [ $(( $(date +%s) - $(stat -f %m "$lock" 2>/dev/null || stat -c %Y "$lock" 2>/dev/null || date +%s) )) -gt 10 ]; return; fi
  ! kill -0 "$pid" 2>/dev/null
}

release() { [ "$(cat "$lock/pid" 2>/dev/null)" = "$$" ] && rm -rf "$lock"; return 0; }
queue="$root/queue"; mkdir -p "$queue"
ticket="$queue/$(python3 -c 'import time; print(time.time_ns())' 2>/dev/null || echo "$(date +%s)000000000")-$$"; echo "$$ $what" >"$ticket"
trap 'rm -f "$ticket"; release' EXIT
trap 'exit 143' TERM; trap 'exit 130' INT; trap 'exit 129' HUP
ahead() {  # the oldest live waiter before my ticket, as "<what> (pid N)"; dead waiters are dropped on the way
  local name pid
  for name in $(ls "$queue" 2>/dev/null | sort); do
    [ "$queue/$name" = "$ticket" ] && return 0
    pid="$(cut -d' ' -f1 "$queue/$name" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "$(cut -d' ' -f2- "$queue/$name") (pid $pid)"; return 0; fi
    rm -f "$queue/$name"
  done
}

wait_max="${JOB_PILOTTO_HEAVY_WAIT:-1800}"; began=$(date +%s); told=0
while :; do
  first="$(ahead)"
  if [ -z "$first" ]; then
    mkdir "$lock" 2>/dev/null && break
    if stale; then
      gone="$root/stale.$$"; mv "$lock" "$gone" 2>/dev/null && { say "taking over a stale lock: $(cat "$gone/what" 2>/dev/null) (pid $(cat "$gone/pid" 2>/dev/null) is gone)"; rm -rf "$gone"; }
      continue
    fi
  fi
  waited=$(( $(date +%s) - began ))
  if [ "$waited" -ge "$wait_max" ]; then say "waited ${wait_max}s for the lock held by $(holder): running anyway"; break; fi
  if [ "$told" = 0 ] || [ $((waited % 30)) -lt 2 ]; then
    if [ -d "$lock" ]; then say "$what waits: the lock is held by $(holder)${first:+, then $first is ahead}; waited ${waited}s (JOB_PILOTTO_HEAVY=0 skips this)"
    else say "$what waits: $first asked first; waited ${waited}s (JOB_PILOTTO_HEAVY=0 skips this)"; fi
    told=1; sleep 1
  fi
  sleep 1
done
rm -f "$ticket"
if [ -d "$lock" ] && [ ! -s "$lock/pid" ]; then echo $$ >"$lock/pid"; echo "$what" >"$lock/what"; date +%s >"$lock/since"; pwd >"$lock/cwd"; fi
if [ "$told" = 1 ] && [ "${GATE_TIMING:-1}" != 0 ]; then   # every wait, for the next measurement
  timing="${JOB_PILOTTO_HEAVY_TIMING_LOG:-$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/gate-timing.log}"
  [ "$timing" = /gate-timing.log ] || echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) heavy lock wait=$(( $(date +%s) - began ))s what=$what" >>"$timing" 2>/dev/null || true
fi
[ "$told" = 1 ] && say "got the lock after $(( $(date +%s) - began ))s"

# A busy machine (seven sessions' suites at once: load 40-147 on 11 Oct 2026) makes browser runs time out; wait for it to calm down.
cores="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 8)"
limit="${JOB_PILOTTO_HEAVY_LOAD:-$(( cores * 3 / 2 ))}"; load_wait="${JOB_PILOTTO_HEAVY_LOAD_WAIT:-300}"; began=$(date +%s); told=0
load1() { uptime | sed -E 's/.*load averages?: *//' | awk -F'[ ,]+' '{ printf "%d", $1 + 0.5 }'; }
if [ "$limit" -gt 0 ] 2>/dev/null; then
  while [ "$(load1)" -gt "$limit" ]; do
    waited=$(( $(date +%s) - began ))
    if [ "$waited" -ge "$load_wait" ]; then say "load is still $(load1) (limit $limit) after ${load_wait}s: running $what anyway"; break; fi
    [ "$told" = 0 ] || [ $((waited % 30)) -lt 2 ] && say "$what waits for the machine: 1-minute load $(load1) is above $limit (up to ${load_wait}s)"
    told=1; sleep 5
  done
fi
say "$what runs (pid $$)"
JP_HEAVY_HELD=$$ "$@"
