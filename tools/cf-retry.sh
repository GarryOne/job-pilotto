#!/usr/bin/env bash
# Runs a Cloudflare call (a wrangler deploy or secret put) up to 3 times: Cloudflare's API answered 504 twice on 12 Oct 2026 and failed the site's release.
# Both calls are safe to repeat. A secret read from stdin goes inside the command: tools/cf-retry.sh bash -c 'printf "%s" "$KEY" | npx wrangler@4 secret put KEY'.
#   CF_RETRY_WAIT=<s> the first wait between tries (default 15, doubled each time). Guard: tests/test_workflow_cf_retry.py.
wait="${CF_RETRY_WAIT:-15}"
for try in 1 2 3; do
  "$@" && exit 0
  code=$?
  [ "$try" = 3 ] && { echo "cf-retry: failed 3 times (exit $code): $1 ..." >&2; exit "$code"; }
  echo "cf-retry: try $try of 3 failed (exit $code), again in ${wait}s" >&2
  sleep "$wait"; wait=$(( wait * 2 ))
done
