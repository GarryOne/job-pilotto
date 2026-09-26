#!/usr/bin/env bash
# notify.sh <job URL> <message> — macOS notification about one job, e.g.
#   Job Pilotto / grafanalabs job 6103687004 / Form filled — review and Submit
# Used by the launchers' agents at hand-over and by wait-and-mark-applied.sh. No-op off macOS.
url="${1:?usage: $0 <job URL> <message>}"
message="${2:?usage: $0 <job URL> <message>}"
id="$(printf '%s' "${url%%\?*}" | sed -E 's#/+$##; s#.*/##')"
board="$(printf '%s' "$url" | sed -E 's#https?://[^/]+/([^/?]+).*#\1#')"
case "$url" in *amazon.jobs*) board=amazon; id="$(printf '%s' "$url" | sed -E 's#.*/jobs/([0-9]+).*#\1#')" ;; esac
command -v osascript >/dev/null || exit 0
osascript - "$message" "$board job $id" <<'OSA' 2>/dev/null
on run argv
  display notification (item 1 of argv) with title "Job Pilotto" subtitle (item 2 of argv) sound name "Glass"
end run
OSA
exit 0
