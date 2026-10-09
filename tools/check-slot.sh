#!/usr/bin/env bash
# Machine-wide queue for the push checks: at most JOB_PILOTTO_CHECK_SLOTS (default 2) run at once on this Mac, so three sessions
# pushing together take turns instead of running three full sets on one CPU. Guarded by tests/test_check_slot.py.
#   tools/check-slot.sh <command...>           waits for a free slot (says so), runs the command, frees the slot, keeps its exit code
#   source tools/check-slot.sh; slot_acquire   ...  slot_release     (used by tools/pre-push-check.sh around its suites)
# A slot is a directory holding the owner's pid; one whose process is gone (killed run, reboot) is taken over at once.
# JOB_PILOTTO_CHECK_SLOTS=0 skips the queue; a wait longer than JOB_PILOTTO_CHECK_WAIT seconds (default 600) runs anyway.
SLOT_MINE=""

slot_claim() {  # try every slot; sets SLOT_MINE
  local slots="${JOB_PILOTTO_CHECK_SLOTS:-2}" root="${JOB_PILOTTO_CHECK_SLOT_DIR:-${TMPDIR:-/tmp}/job-pilotto-check-slots}" i dir pid
  mkdir -p "$root"
  for i in $(seq 1 "$slots"); do
    dir="$root/slot$i"
    if mkdir "$dir" 2>/dev/null; then echo $$ >"$dir/pid"; SLOT_MINE="$dir"; return 0; fi
    pid="$(cat "$dir/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then   # its owner is gone: take the slot over
      echo $$ >"$dir/pid.new" && mv -f "$dir/pid.new" "$dir/pid" && { SLOT_MINE="$dir"; return 0; }
    fi
  done
  return 1
}

slot_acquire() {
  local slots="${JOB_PILOTTO_CHECK_SLOTS:-2}" wait_max="${JOB_PILOTTO_CHECK_WAIT:-600}" started told=0
  [ "$slots" -gt 0 ] 2>/dev/null || return 0
  started="$(date +%s)"
  until slot_claim; do
    if [ $(( $(date +%s) - started )) -ge "$wait_max" ]; then echo "check-slot: waited ${wait_max}s, running anyway" >&2; return 0; fi
    [ "$told" = 0 ] && echo "check-slot: $slots other check run(s) are using this Mac; waiting for a free slot (up to ${wait_max}s)" >&2
    told=1; sleep 2
  done
  [ "$told" = 1 ] && echo "check-slot: got a slot after $(( $(date +%s) - started ))s" >&2
  return 0
}

slot_release() { [ -n "$SLOT_MINE" ] && rm -rf "$SLOT_MINE"; SLOT_MINE=""; return 0; }

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  slot_acquire
  trap slot_release EXIT
  trap 'slot_release; exit 143' TERM INT HUP
  "$@"
fi
