#!/usr/bin/env bash
# wait-and-mark-applied.sh <job URL> — wait until that job's application is submitted, then mark
# it Applied in Notion. Started in the background by every apply-batch launcher (ChatGPT, Codex,
# Claude) right after queueing a job.
#
# Polls Chrome's open tab URLs every 20 s for this job's confirmation page (Greenhouse
# ".../<id>/confirmation", Lever ".../<id>/thanks"); only this job's id is matched, nothing else is
# read or logged. Gives up quietly after 3 hours.
set -uo pipefail

url="${1:?usage: $0 <job URL>}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
id="$(printf '%s' "${url%%\?*}" | sed -E 's#/+$##; s#.*/##')"

# Everything goes to one log: tail -f ~/Library/Logs/JobPilotto/wait-and-mark-applied.log
log_dir="$HOME/Library/Logs/JobPilotto"
mkdir -p "$log_dir"
exec >>"$log_dir/wait-and-mark-applied.log" 2>&1
say() { echo "$(date '+%F %T') [$id] $*"; }
# One watcher per job: a relaunch of the same job doesn't start a second one.
if pgrep -f "wait-and-mark-applied.sh $url\$" | grep -vqx "$$"; then
  say "already watched by another process; exiting"
  exit 0
fi
say "watching for submission of $url"
notify() { "$repo/tools/notify.sh" "$url" "$1"; }

for _ in $(seq 540); do
  if [ "$(osascript -e 'application "Google Chrome" is running' 2>/dev/null)" = "true" ] &&
     osascript -e 'tell application "Google Chrome" to get URL of tabs of windows' 2>/dev/null |
       grep -Eq "$id/(confirmation|thanks)"; then
    token="${NOTION_TOKEN:-$(security find-generic-password -a "$USER" -s job-pilotto.notion.token -w 2>/dev/null)}"
    say "confirmation page seen"
    if (cd "$repo" && NOTION_TOKEN="$token" python3 -m src.ai.apply_batch --mark-applied "$url"); then
      notify "Submitted — marked Applied in Notion"
      say "marked applied"
      exit 0
    fi
    say "FAILED to mark applied — run: python3 -m src.ai.apply_batch --mark-applied $url"
    notify "Could not mark applied — see ~/Library/Logs/JobPilotto"
    exit 1
  fi
  sleep 20
done
say "gave up after 3 hours without seeing a confirmation page"
exit 1
