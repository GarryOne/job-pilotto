#!/usr/bin/env bash
# One lock per e2e suite (it owns one Notion page) that WAITS: a job takes it and holds it to the end; another job of the same suite polls until it is free.
# Why not a `concurrency:` group: GitHub keeps ONE waiting job per group and a newer one cancels the older (beta 14, 24 Oct 2026: 12 jobs cancelled by other runs' jobs).
# The lock is the git ref refs/e2e-locks/<key>, created atomically; its commit message names the holder. A lock whose run has finished is taken over.
# Usage: e2e-lock.sh acquire <key> | e2e-lock.sh release <key>   (needs GH_TOKEN with contents: write, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_JOB, GITHUB_SHA)
# Tests: tests/test_e2e_lock.py
set -uo pipefail

cmd="${1:?acquire|release}"; key="${2:?suite key}"
repo="${GITHUB_REPOSITORY:?}"; ref="e2e-locks/${key}"
me="run=${GITHUB_RUN_ID:?} job=${GITHUB_JOB:?}"
poll="${E2E_LOCK_POLL:-20}"; max="${E2E_LOCK_MAX:-10800}"   # three hours, then the job fails by name instead of hanging

holder_sha() { gh api "repos/${repo}/git/ref/${ref}" --jq .object.sha 2>/dev/null; }
holder_msg() { gh api "repos/${repo}/git/commits/$1" --jq .message 2>/dev/null; }
drop() { gh api -X DELETE "repos/${repo}/git/refs/${ref}" >/dev/null 2>&1; }

acquire() {
  local tree commit start held msg run status
  tree="$(gh api "repos/${repo}/git/commits/${GITHUB_SHA:?}" --jq .tree.sha)" || { echo "e2e-lock: cannot read the tree of ${GITHUB_SHA}" >&2; exit 1; }
  start=$SECONDS; said=-60
  while true; do
    commit="$(gh api -X POST "repos/${repo}/git/commits" -f message="${me}" -f tree="${tree}" --jq .sha)" || { echo "e2e-lock: cannot create the lock commit" >&2; exit 1; }
    if gh api -X POST "repos/${repo}/git/refs" -f ref="refs/${ref}" -f sha="${commit}" >/dev/null 2>&1; then
      echo "e2e-lock: ${key} taken by ${me}"; return 0
    fi
    held="$(holder_sha)"
    if [ -z "$held" ]; then continue; fi   # released between our two calls: try again at once
    msg="$(holder_msg "$held")"; run="$(printf '%s' "$msg" | sed -n 's/^run=\([0-9]*\).*/\1/p' | head -n1)"
    status="$(gh api "repos/${repo}/actions/runs/${run:-0}" --jq .status 2>/dev/null || echo gone)"
    if [ "$status" = "completed" ] || [ "$status" = "gone" ]; then
      echo "e2e-lock: ${key} was held by ${msg} (run ${status}): taking it over"
      [ "$(holder_sha)" = "$held" ] && drop
      continue
    fi
    if [ $((SECONDS - start)) -ge "$max" ]; then echo "e2e-lock: waited ${max}s for ${key}, held by ${msg}" >&2; exit 1; fi
    if [ $((SECONDS - said)) -ge 60 ]; then said=$SECONDS; echo "e2e-lock: ${key} is held by ${msg} (run ${status}), waiting"; fi
    sleep "$poll"
  done
}

release() {
  local held
  held="$(holder_sha)"; [ -n "$held" ] || exit 0
  if [ "$(holder_msg "$held")" = "$me" ]; then drop && echo "e2e-lock: ${key} released"; fi
  exit 0
}

case "$cmd" in acquire) acquire ;; release) release ;; *) echo "usage: e2e-lock.sh acquire|release <key>" >&2; exit 2 ;; esac
