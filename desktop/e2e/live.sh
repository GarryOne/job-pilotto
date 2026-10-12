#!/bin/bash
# npm run live: the site limit first (live-check.mjs), then the heavy lock, then the row (live.mjs).
node "$(dirname "$0")/live-check.mjs" "$@" || exit $?
JOB_PILOTTO_HEAVY_CLASS=proof exec bash "$(dirname "$0")/../../tools/heavy-lock.sh" e2e-smoke node "$(dirname "$0")/live.mjs" "$@"
