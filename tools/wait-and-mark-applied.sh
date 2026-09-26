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

for _ in $(seq 540); do
  if [ "$(osascript -e 'application "Google Chrome" is running' 2>/dev/null)" = "true" ] &&
     osascript -e 'tell application "Google Chrome" to get URL of tabs of windows' 2>/dev/null |
       grep -Eq "$id/(confirmation|thanks)"; then
    token="${NOTION_TOKEN:-$(security find-generic-password -a "$USER" -s job-pilotto.notion.token -w 2>/dev/null)}"
    cd "$repo" && NOTION_TOKEN="$token" python3 -m src.ai.apply_batch --mark-applied "$url"
    osascript -e 'display notification "Marked applied in Notion" with title "Job Pilotto"' 2>/dev/null
    exit 0
  fi
  sleep 20
done
exit 1
