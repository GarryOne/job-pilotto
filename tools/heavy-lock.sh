#!/usr/bin/env bash
# Heavy runs on this Mac: browser suites, recorded replays, real-extension and the e2e harness take this lock; unit tests never do.
#   bash tools/heavy-lock.sh <what> <command...>      waits for a slot (says who holds them), waits while the load is high, runs, frees it, keeps the exit code
# ONE copy for every session (owner, 11 Oct 2026): a worktree's copy hands off to the primary checkout's (<git common dir>/..), so all queue in one order.
# Slots = directories <TMPDIR>/job-pilotto-heavy/lock and lock.2 holding pid, what, since, cwd; stale when the pid is gone (taken over by an atomic rename).
# The first heavy run always starts; a 2nd starts beside it only when free+inactive memory is over 7 GB and swap is low (owner, 11 Oct 2026: one pool run
# peaks at 3.3 GB, two need ~6.6 GB); never a 3rd. Ports are free per run and the real Notion page has its own lock (desktop/e2e/lib/notion-page-lock.mjs).
# First come, first served (11 Oct 2026: the pool's per-site runs re-took a just-freed lock while a replay starved 6+ min): each waiter holds a ticket
# <root>/queue/<nanoseconds>-<pid> ("<pid> <what>") and takes a slot only when no live older ticket is ahead; a dead waiter's ticket is dropped.
# Shortest first (owner, 11 Oct 2026: a ~15 s row replay waited 1-3 min behind ~70 s live runs): a waiter whose `what` is `row` or `row-*` goes ahead of older
# longer waiters, and a longer waiter yields to a younger row waiter, each only while it has waited under JOB_PILOTTO_HEAVY_SHORT_AGE seconds (default 120),
# so nobody starves. Replays (row*, recorded-replay) wait for the memory gate, never for the load. A ticket names its session (JOB_PILOTTO_SESSION, else the
# branch of the working folder) and the log lines say it. JOB_PILOTTO_HEAVY_SHORT_FIRST=0 = strict arrival order; JOB_PILOTTO_HEAVY_REPLAY_LOAD=1 = replays wait for the load too.
# Every wait is logged to <git common dir>/gate-timing.log (JOB_PILOTTO_HEAVY_TIMING_LOG elsewhere, GATE_TIMING=0 off).
# A nested call (a suite started by `npm run all`) sees JP_HEAVY_HELD and runs at once. Escape hatches, all said in the log when used:
#   JOB_PILOTTO_HEAVY=0                 no lock, no load wait
#   JOB_PILOTTO_HEAVY_WAIT=<s>          longest wait for a slot before running anyway (default 1800)
#   JOB_PILOTTO_HEAVY_SLOTS=<n>         1 = one heavy run at a time; default 2 (the 2nd behind the memory check)
#   JOB_PILOTTO_HEAVY_MEM_GB=<n>        free+inactive memory a 2nd run needs, in GB (default 7); a `recorded-replay` or `row-replay` needs JOB_PILOTTO_HEAVY_MEM_REPLAY_GB (3) and swap up to JOB_PILOTTO_HEAVY_SWAP_REPLAY_PCT (70)
#   JOB_PILOTTO_HEAVY_SWAP_PCT=<n>      most swap used, in percent, for a 2nd run (default 50)
#   JOB_PILOTTO_HEAVY_SHARED=<path>     the shared copy to run (default the primary checkout's); this script never hands off to itself
#   JOB_PILOTTO_HEAVY_LOAD=<n>          1-minute load average above which a run waits (default 1.5 x cores); 0 = never wait for load
#   JOB_PILOTTO_HEAVY_POLL=<s>          seconds between looks at the queue and the load (default 1; the tests use 0.1)
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
    out="${out:+$out and }pid ${pid:-?} (${what:-?}, session $(cat "$dir/session" 2>/dev/null || echo ?)) since $(date -r "${since:-0}" +%T 2>/dev/null || echo ?), $(( $(date +%s) - ${since:-$(date +%s)} ))s ago"; done
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
  # A recorded-page replay is counted by its real cost (owner's brief, 11 Oct 2026): ~1.5 GB of Chrome at 4 tabs (2.1 GB at 6), not a pool run's 3.3 GB; a row replay (npm run row: one offline browser, ~1 GB) the same.
  case "$what" in recorded-replay|row|row-*) floor="${JOB_PILOTTO_HEAVY_MEM_REPLAY_GB:-3}"; most="${JOB_PILOTTO_HEAVY_SWAP_REPLAY_PCT:-70}" ;; esac
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
branch_now="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ?)"
[ -f "$(dirname "$0")/session-name.sh" ] && source "$(dirname "$0")/session-name.sh" && session="$(session_name)" || session="${JOB_PILOTTO_SESSION:-?}"
[ "$session" = ? ] && session="$branch_now"   # no session name found: the branch still says whose run it is
is_short() { case "$1" in row|row-*) return 0 ;; *) return 1 ;; esac; }   # a row replay: one offline browser, ~15 s
is_replay() { case "$1" in row|row-*|recorded-replay) return 0 ;; *) return 1 ;; esac; }
short_first="${JOB_PILOTTO_HEAVY_SHORT_FIRST:-1}"; short_age="${JOB_PILOTTO_HEAVY_SHORT_AGE:-120}"
ticket="$queue/$(python3 -c 'import time; print(time.time_ns())' 2>/dev/null || echo "$(date +%s)000000000")-$$"; printf '%s %s\n\n%s\n' "$$" "$what" "$session" >"$ticket"
trap 'rm -f "$ticket"; release' EXIT
trap 'exit 143' TERM; trap 'exit 130' INT; trap 'exit 129' HUP
age_of() { local ns="${1%%-*}"; echo $(( $(date +%s) - ns / 1000000000 )); }   # seconds a ticket has waited (its name starts with the nanosecond clock)
ticket_label() { echo "$(head -n 1 "$queue/$1" | cut -d' ' -f2-) (pid $2, session $(sed -n 3p "$queue/$1" 2>/dev/null || echo ?))"; }
ahead() {  # the waiter I must let go first, as "<what> (pid N, session S)"; dead waiters are dropped on the way
  local name pid mine=0 mname="${ticket##*/}"
  for name in $(ls "$queue" 2>/dev/null | sort); do
    if [ "$name" = "$mname" ]; then
      mine=1
      # a longer waiter yields to a younger row waiter, while it has waited under short_age seconds
      if [ "$short_first" = 1 ] && ! is_short "$what" && [ "$(age_of "$mname")" -lt "$short_age" ]; then continue; else return 0; fi
    fi
    pid="$(head -n 1 "$queue/$name" 2>/dev/null | cut -d' ' -f1)"
    [ "$(sed -n 2p "$queue/$name" 2>/dev/null)" = loadwait ] && continue   # it waits for the machine, holding no slot: it does not hold anyone up
    if [ "$mine" = 1 ]; then   # only younger row waiters count here
      is_short "$(head -n 1 "$queue/$name" | cut -d' ' -f2-)" && kill -0 "$pid" 2>/dev/null && { ticket_label "$name" "$pid"; return 0; }
      continue
    fi
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      # a row waiter goes ahead of an older longer waiter that has waited under short_age seconds
      if [ "$short_first" = 1 ] && is_short "$what" && ! is_short "$(head -n 1 "$queue/$name" | cut -d' ' -f2-)" && [ "$(age_of "$name")" -lt "$short_age" ]; then continue; fi
      ticket_label "$name" "$pid"; return 0
    fi
    rm -f "$queue/$name"
  done
}

wait_max="${JOB_PILOTTO_HEAVY_WAIT:-1800}"; poll="${JOB_PILOTTO_HEAVY_POLL:-1}"; began=$(date +%s); told=0
# A busy machine (seven sessions' suites at once: load 40-147 on 11 Oct 2026) makes browser runs time out; wait for it to calm down. The wait is IN THE QUEUE, holding no slot
# (11 Oct 2026: a run took the slot and then sat 12 min in the load wait while two landings queued behind it), and a waiter that waits only for the machine does not hold up
# the ones behind it (its ticket says "loadwait"): whoever is ready first goes, the older first.
cores="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 8)"
limit="${JOB_PILOTTO_HEAVY_LOAD:-$(( cores * 3 / 2 ))}"; load_wait="${JOB_PILOTTO_HEAVY_LOAD_WAIT:-300}"; load_began=""; load_gave_up=0
load1() { uptime | sed -E 's/.*load averages?: *//' | awk -F'[ ,]+' '{ printf "%d", $1 + 0.5 }'; }
load_queue="$(load1)"
mark() { printf '%s %s\n%s\n%s\n' "$$" "$what" "$1" "$session" >"$ticket"; }   # the ticket keeps its name (its place in line); only its second line changes
machine_ready() {  # sets $why when not
  [ "$limit" -gt 0 ] 2>/dev/null || return 0
  [ "$load_gave_up" = 1 ] && return 0
  is_replay "$what" && [ "${JOB_PILOTTO_HEAVY_REPLAY_LOAD:-0}" != 1 ] && return 0   # replays wait for the memory gate, not the load
  if [ "$(load1)" -le "$limit" ]; then load_began=""; return 0; fi
  [ -n "$load_began" ] || load_began=$(date +%s)
  if [ $(( $(date +%s) - load_began )) -ge "$load_wait" ]; then say "load is still $(load1) (limit $limit) after ${load_wait}s: running $what anyway"; load_gave_up=1; return 0; fi
  why="the machine is busy: 1-minute load $(load1) is above $limit (up to ${load_wait}s)"; return 1
}
while :; do
  first=""; why=""; busy="$(held)"
  if machine_ready; then
    mark ""
    first="$(ahead)"
    if [ -z "$first" ]; then
      if [ "$busy" = 0 ]; then take && break
      elif [ "$busy" -lt "$(echo $SLOT_DIRS | wc -w)" ] && memory_ok; then take && break; fi
    fi
  else mark loadwait; fi
  waited=$(( $(date +%s) - began ))
  if [ "$waited" -ge "$wait_max" ]; then say "waited ${wait_max}s for the lock held by $(holders): running anyway"; break; fi
  if [ "$told" = 0 ] || [ $((waited % 30)) -lt 2 ]; then
    if [ -n "$why" ]; then say "$what waits for the machine, holding no slot: $why"
    elif [ "$busy" != 0 ]; then say "$what waits: the lock is held by $(holders)${first:+, then $first is ahead}; waited ${waited}s (JOB_PILOTTO_HEAVY=0 skips this)"
    else say "$what waits: $first asked first; waited ${waited}s (JOB_PILOTTO_HEAVY=0 skips this)"; fi
    told=1; sleep "$poll"
  fi
  sleep "$poll"
done
rm -f "$ticket"
if [ -n "$lock" ]; then echo $$ >"$lock/pid"; echo "$what" >"$lock/what"; echo "$session" >"$lock/session"; date +%s >"$lock/since"; pwd >"$lock/cwd"; fi
# Every hold is logged with the branch and session it belongs to and the load at queueing and at start, so a fix's proof waits can be summed (tools/landing-report.mjs).
timing_log() {  # <text after the time stamp>
  [ "${GATE_TIMING:-1}" != 0 ] || return 0
  local timing="${JOB_PILOTTO_HEAVY_TIMING_LOG:-$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/gate-timing.log}"
  [ "$timing" = /gate-timing.log ] || echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >>"$timing" 2>/dev/null || true
}
waited_s=$(( $(date +%s) - began )); load_start="$(load1)"
ident="what=$what branch=$branch_now session=$session load_q=$load_queue load_start=$load_start"
if [ "$told" = 1 ]; then
  say "got the lock after ${waited_s}s"
  timing_log "heavy lock wait=${waited_s}s $ident"   # every wait, for the next measurement
fi

say "$what runs (pid $$)"
run_began=$(date +%s); code=0
JP_HEAVY_HELD=$$ "$@" || code=$?
timing_log "heavy lock run=$(( $(date +%s) - run_began ))s wait=${waited_s}s exit=$code $ident"
exit "$code"
