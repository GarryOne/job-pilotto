#!/usr/bin/env bash
# Heavy runs on this Mac: browser suites, recorded replays, real-extension and the e2e harness take this lock; unit tests never do.
#   bash tools/heavy-lock.sh <what> <command...>      waits for a slot (says who holds them), waits while the load is high, runs, frees it, keeps the exit code
# ONE copy for every session (owner, 11 Oct 2026): a worktree's copy hands off to the primary checkout's (<git common dir>/..), so all queue in one order.
# Slots = directories <TMPDIR>/job-pilotto-heavy/lock and lock.2 holding pid, what, since, cwd; stale when the pid is gone (taken over by an atomic rename).
# The first heavy run always starts; a 2nd starts beside it only when free+inactive memory is over 7 GB and swap is low (owner, 11 Oct 2026: one pool run
# peaks at 3.3 GB, two need ~6.6 GB); never a 3rd. Ports are free per run and the real Notion page has its own lock (desktop/e2e/lib/notion-page-lock.mjs).
# First come, first served (11 Oct 2026: the pool's per-site runs re-took a just-freed lock while a replay starved 6+ min): each waiter holds a ticket
# <root>/queue/<nanoseconds>-<pid> ("<pid> <what>") and takes a slot only when no live older ticket is ahead; a dead waiter's ticket is dropped.
# Every wait is logged to <git common dir>/gate-timing.log (JOB_PILOTTO_HEAVY_TIMING_LOG elsewhere, GATE_TIMING=0 off).
# A nested call (a suite started by `npm run all`) sees JP_HEAVY_HELD and runs at once. Escape hatches, all said in the log when used:
#   JOB_PILOTTO_HEAVY=0                 no lock, no load wait
#   JOB_PILOTTO_HEAVY_WAIT=<s>          longest wait for a slot before running anyway (default 1800)
#   JOB_PILOTTO_HEAVY_SLOTS=<n>         1 = one heavy run at a time; default 2 (the 2nd behind the memory check)
#   JOB_PILOTTO_HEAVY_MEM_GB=<n>        free+inactive memory a 2nd run needs, in GB (default 7)
#   JOB_PILOTTO_HEAVY_SWAP_PCT=<n>      most swap used, in percent, for a 2nd run (default 50)
#   JOB_PILOTTO_HEAVY_SHARED=<path>     the shared copy to run (default the primary checkout's); this script never hands off to itself
#   JOB_PILOTTO_HEAVY_LOAD=<n>          1-minute load average above which a run waits (default 1.5 x cores); 0 = never wait for load
#   JOB_PILOTTO_HEAVY_LOAD_WAIT=<s>     longest wait for the load to drop before running anyway (default 300)
# Owner: landing-speed (11 Oct 2026, spec faster-fixes §6). Guarded by tests/test_heavy_lock.py.
what="${1:-heavy run}"; shift || true
[ "$#" -gt 0 ] || { echo "usage: heavy-lock.sh <what> <command...>" >&2; exit 2; }
if [ "${JOB_PILOTTO_HEAVY:-1}" = 0 ] || [ -n "${JP_HEAVY_HELD:-}" ]; then exec "$@"; fi

shared="${JOB_PILOTTO_HEAVY_SHARED:-}"
if [ -z "$shared" ]; then common="$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; [ -n "$common" ] && shared="$(dirname "$common")/tools/heavy-lock.sh"; fi
real() { echo "$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)/$(basename "$1")"; }
if [ -n "$shared" ] && [ -f "$shared" ] && [ "$(real "$shared")" != "$(real "$0")" ]; then JOB_PILOTTO_HEAVY_SHARED="$shared" exec bash "$shared" "$what" "$@"; fi

root="${JOB_PILOTTO_HEAVY_DIR:-${TMPDIR:-/tmp}/job-pilotto-heavy}"; lock=""
mkdir -p "$root"
say() { echo "heavy-lock: $*" >&2; }
SLOT_DIRS="$root/lock"; [ "${JOB_PILOTTO_HEAVY_SLOTS:-2}" -ge 2 ] 2>/dev/null && SLOT_DIRS="$SLOT_DIRS $root/lock.2"
holders() { local dir pid what since out=""
  for dir in $SLOT_DIRS; do [ -d "$dir" ] || continue; pid="$(cat "$dir/pid" 2>/dev/null)"; what="$(cat "$dir/what" 2>/dev/null)"; since="$(cat "$dir/since" 2>/dev/null)"
    out="${out:+$out and }pid ${pid:-?} (${what:-?}) since $(date -r "${since:-0}" +%T 2>/dev/null || echo ?), $(( $(date +%s) - ${since:-$(date +%s)} ))s ago"; done
  echo "${out:-nobody}"; }
stale() {  # a slot's owner is gone (or never wrote its pid within 10 s)
  local pid; pid="$(cat "$1/pid" 2>/dev/null)"
  if [ -z "$pid" ]; then [ $(( $(date +%s) - $(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || date +%s) )) -gt 10 ]; return; fi
  ! kill -0 "$pid" 2>/dev/null
}
held() {  # live slots, after dropping stale ones
  local dir count=0 gone
  for dir in $SLOT_DIRS; do
    [ -d "$dir" ] || continue
    if stale "$dir"; then gone="$root/stale.$$"; mv "$dir" "$gone" 2>/dev/null && { say "taking over a stale lock: $(cat "$gone/what" 2>/dev/null) (pid $(cat "$gone/pid" 2>/dev/null) is gone)"; rm -rf "$gone"; }; continue; fi
    count=$((count + 1))
  done
  echo "$count"
}
memory_ok() {  # a 2nd heavy run fits: free+inactive memory over the floor and swap low; sets $why when not
  local free swap floor="${JOB_PILOTTO_HEAVY_MEM_GB:-7}" most="${JOB_PILOTTO_HEAVY_SWAP_PCT:-50}"
  free="$(vm_stat 2>/dev/null | awk '/page size of/ {for (i = 1; i < NF; i++) if ($i == "of") size = $(i + 1)} /^Pages (free|inactive):/ {v = $NF; sub(/\./, "", v); pages += v} END {printf "%.1f", pages * size / 1073741824}')"
  swap="$(sysctl -n vm.swapusage 2>/dev/null | awk '{for (i = 1; i < NF; i++) {if ($i == "total") t = $(i + 2) + 0; if ($i == "used") u = $(i + 2) + 0}} END {printf "%d", (t > 0 ? u * 100 / t : 0)}')"
  why=""
  awk -v f="${free:-0}" -v m="$floor" 'BEGIN {exit !(f > m)}' || why="free+inactive memory ${free:-0} GB, a 2nd run needs over $floor"
  [ "${swap:-0}" -le "$most" ] || why="${why:+$why; }swap ${swap}% used, a 2nd run needs $most% or less"
  [ -z "$why" ]
}
take() { local dir; for dir in $SLOT_DIRS; do mkdir "$dir" 2>/dev/null && { lock="$dir"; return 0; }; done; return 1; }
release() { [ -n "$lock" ] && [ "$(cat "$lock/pid" 2>/dev/null)" = "$$" ] && rm -rf "$lock"; return 0; }
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
  first="$(ahead)"; why=""; busy="$(held)"
  if [ -z "$first" ]; then
    if [ "$busy" = 0 ]; then take && break
    elif [ "$busy" -lt "$(echo $SLOT_DIRS | wc -w)" ] && memory_ok; then take && break; fi
  fi
  waited=$(( $(date +%s) - began ))
  if [ "$waited" -ge "$wait_max" ]; then say "waited ${wait_max}s for the lock held by $(holders): running anyway"; break; fi
  if [ "$told" = 0 ] || [ $((waited % 30)) -lt 2 ]; then
    if [ "$busy" != 0 ]; then say "$what waits: the lock is held by $(holders)${first:+, then $first is ahead}${why:+ ($why)}; waited ${waited}s (JOB_PILOTTO_HEAVY=0 skips this)"
    else say "$what waits: $first asked first; waited ${waited}s (JOB_PILOTTO_HEAVY=0 skips this)"; fi
    told=1; sleep 1
  fi
  sleep 1
done
rm -f "$ticket"
if [ -n "$lock" ]; then echo $$ >"$lock/pid"; echo "$what" >"$lock/what"; date +%s >"$lock/since"; pwd >"$lock/cwd"; fi
if [ "$told" = 1 ]; then
  say "got the lock after $(( $(date +%s) - began ))s"
  if [ "${GATE_TIMING:-1}" != 0 ]; then   # every wait, for the next measurement
    timing="${JOB_PILOTTO_HEAVY_TIMING_LOG:-$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/gate-timing.log}"
    [ "$timing" = /gate-timing.log ] || echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) heavy lock wait=$(( $(date +%s) - began ))s what=$what" >>"$timing" 2>/dev/null || true
  fi
fi

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
