#!/usr/bin/env bash
# Keep the release list short: every stable release stays, and only the newest few test builds (pre-releases).
# Older pre-releases lose their release page and files; their git tags stay (friends' Always on runs point at tags).
# Runs after each desktop build (desktop.yml); by hand: tools/prune-releases.sh [how many test builds to keep, default 3]
# Also kept: the canary, the oldest test build newer than stable, so it can age 48 h and be auto-promoted
# (tools/canary_promote.py; the owner's app stays on it for that trial). After 7 days it's dropped too (it had
# problems), and the next oldest becomes the canary.
set -euo pipefail
repo=${GITHUB_REPOSITORY:-GarryOne/job-pilotto}
keep=${1:-3}
# Newest first; drafts are builds still running, so they're left alone.
releases=$(gh release list -R "$repo" -L 1000 --json tagName,isPrerelease,isDraft,isLatest,createdAt)
# The canary: one rule for this script, the auto-promote and the owner's app (tools/canary_promote.py canary_of).
canary=$(python3 "$(dirname "$0")/canary_promote.py" --canary <<<"$releases")
jq -r '[.[] | select(.isPrerelease and (.isDraft | not))] | sort_by(.createdAt) | reverse | .['"$keep"':][] | .tagName' <<<"$releases" |
while read -r tag; do
  [ "$tag" = "$canary" ] && { echo "Kept canary $tag (auto-promote candidate)"; continue; }
  gh release delete "$tag" -R "$repo" --yes
  echo "Removed test build $tag (tag kept)"
done
