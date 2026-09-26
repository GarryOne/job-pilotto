#!/usr/bin/env bash
# notify.sh <job URL> <message> — macOS notification about one job, e.g.
#   Job Pilotto / grafanalabs job 6103687004 / Form filled — review and Submit
# Clicking it brings the Terminal window of the session that sent it to the front (needs
# `brew install terminal-notifier`; without it, a plain notification). Used by the launchers'
# agents, the Codex runner and wait-and-mark-applied.sh. No-op off macOS.
url="${1:?usage: $0 <job URL> <message>}"
message="${2:?usage: $0 <job URL> <message>}"
here="$(cd "$(dirname "$0")" && pwd)"
id="$(printf '%s' "${url%%\?*}" | sed -E 's#/+$##; s#.*/##')"
board="$(printf '%s' "$url" | sed -E 's#https?://[^/]+/([^/?]+).*#\1#')"
case "$url" in *amazon.jobs*) board=amazon; id="$(printf '%s' "$url" | sed -E 's#.*/jobs/([0-9]+).*#\1#')" ;; esac
command -v osascript >/dev/null || exit 0

# The Terminal tab this came from: the nearest ancestor process attached to a tty (agents run
# tools in subprocesses without one). Empty for detached processes such as the submit watcher.
tty='' pid=$$
for _ in $(seq 20); do
  t="$(ps -o tty= -p "$pid" 2>/dev/null | tr -d ' ')"
  if [ -n "$t" ] && [ "$t" != "??" ]; then tty="/dev/$t"; break; fi
  pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  { [ -z "$pid" ] || [ "$pid" -le 1 ]; } && break
done

notifier="$(command -v terminal-notifier || true)"
if [ -n "$notifier" ]; then
  args=(-title "Job Pilotto" -subtitle "$board job $id" -message "$message" -sound Glass -group "jobpilotto-$id")
  [ -n "$tty" ] && args+=(-execute "'$here/focus-terminal.sh' '$tty'")
  "$notifier" "${args[@]}" >/dev/null 2>&1
  exit 0
fi
osascript - "$message" "$board job $id" <<'OSA' 2>/dev/null
on run argv
  display notification (item 1 of argv) with title "Job Pilotto" subtitle (item 2 of argv) sound name "Glass"
end run
OSA
exit 0
