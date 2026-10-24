#!/usr/bin/env bash
# Before a push that changes workflow files: wait until the running desktop build has tagged itself (its "Tag this build now" step), not for the whole build. Guarded by tests/test_wait_build_tag.py.
#   bash tools/wait-build-tag.sh      prints one line when it waited; always exits 0 (a failed look at GitHub never blocks a push)
# GitHub refuses a build's release when workflow files changed under it, unless the build tagged at its start (desktop.yml "Tag this build now"): once that
# step is done, a push is safe (11 Oct 2026: was the whole build, up to 20 min). A run whose job has not reached the step yet is waited for; so is one with no step list.
#   SHIP_NO_WAIT=1            no wait at all (ship.sh)          SHIP_WAIT_FOR_BUILD=1   the old wait: for the whole build to end
#   SHIP_WAIT_POLL=<s>        seconds between looks (default 30; the tests use 0.1)        SHIP_WAIT_MAX=<polls>   at most this many looks (default 40: 20 min)
# Every wait is logged to <git common dir>/gate-timing.log (GATE_TIMING=0 off).
repo="${SHIP_WAIT_REPO:-GarryOne/jobadabra}"; poll="${SHIP_WAIT_POLL:-30}"; max="${SHIP_WAIT_MAX:-40}"; began=$SECONDS; waited=0; id=""; tagged=0
for _ in $(seq 1 "$max"); do
  id="$(gh run list -R "$repo" --workflow desktop.yml --status in_progress -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  [ -z "$id" ] && break
  if [ "${SHIP_WAIT_FOR_BUILD:-}" != 1 ]; then
    done_tag="$(gh run view "$id" -R "$repo" --json jobs -q '[.jobs[].steps[]? | select(.name | startswith("Tag this build now")) | .status] | any(. == "completed")' 2>/dev/null || true)"
    if [ "$done_tag" = true ]; then tagged=1; break; fi
  fi
  [ "$waited" = 0 ] && echo "ship: this push changes workflow files and desktop build $id is running: waiting until it has tagged itself${SHIP_WAIT_FOR_BUILD:+ (SHIP_WAIT_FOR_BUILD=1: until it ends)} (at most $(awk -v m="$max" -v p="$poll" 'BEGIN {printf "%d", m * p / 60}') min; SHIP_NO_WAIT=1 skips)" >&2
  waited=1; sleep "$poll"
done
if [ "$waited" = 1 ]; then
  echo "ship: waited $((SECONDS - began))s for desktop build $id ($([ "$tagged" = 1 ] && echo tagged || echo "ended or gave up"))" >&2
  [ "${GATE_TIMING:-1}" = 0 ] || echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) workflow push wait=$((SECONDS - began))s build=$id tagged=$tagged" >>"$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/gate-timing.log" 2>/dev/null || true
fi
exit 0
