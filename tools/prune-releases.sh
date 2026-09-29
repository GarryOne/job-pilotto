#!/usr/bin/env bash
# Keep the release list short: every stable release stays, and only the newest few test builds (pre-releases).
# Older pre-releases lose their release page and files; their git tags stay (friends' Always on runs point at tags).
# Runs after each desktop build (desktop.yml); by hand: tools/prune-releases.sh [how many test builds to keep, default 3]
set -euo pipefail
repo=${GITHUB_REPOSITORY:-GarryOne/job-pilotto}
keep=${1:-3}
# Newest first; drafts are builds still running, so they're left alone.
gh release list -R "$repo" -L 1000 --json tagName,isPrerelease,isDraft,createdAt \
  -q '[.[] | select(.isPrerelease and (.isDraft | not))] | sort_by(.createdAt) | reverse | .['"$keep"':][] | .tagName' |
while read -r tag; do
  gh release delete "$tag" -R "$repo" --yes
  echo "Removed test build $tag (tag kept)"
done
