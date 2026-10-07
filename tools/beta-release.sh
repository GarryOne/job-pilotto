#!/usr/bin/env bash
# A beta by hand, in one shot: one release run (desktop.yml -f beta=true, named "Beta by hand"), the same as the nightly:
#   Build · Mac -> Build · Windows -> Test · Mac + Linux (every gate suite; unit suites green, no high-severity finding, additive Notion schema -> "Beta-approved:")
#   -> Test · Windows (the same suites -> "Beta-approved (Windows):") -> Clean up old builds
# Each platform is approved on its own. A red gate leaves that platform's testers on their current beta. Never call tools/beta-approve.sh by hand: it skips the gate.
#   tools/beta-release.sh [--no-watch]
set -euo pipefail
repo=GarryOne/job-pilotto
gh workflow run desktop.yml -R "$repo" --ref main -f beta=true
sleep 5
run=$(gh run list -R "$repo" --workflow desktop.yml --event workflow_dispatch -L 5 --json databaseId,displayTitle,url \
  -q '[.[] | select(.displayTitle == "Beta by hand")][0] | "\(.databaseId) \(.url)"')
echo "Beta by hand started: ${run#* }"
# Watched to the end (7 Oct 2026: a refused release went unnoticed): which version it published, and which platforms approved it. --no-watch returns at once.
if [ "${1:-}" = "--no-watch" ]; then
  echo "Build, then both gates, in that one run (about 45 minutes); a pass adds 'Beta-approved:' (Mac) and 'Beta-approved (Windows):' to the release notes."
  exit 0
fi
id=${run%% *}
gh run watch "$id" -R "$repo" --interval 30 >/dev/null 2>&1 || true
version=$(gh run view "$id" -R "$repo" --log 2>/dev/null | sed -n 's/.*Releasing \([0-9.]*\).*/\1/p' | head -1)
if gh run view "$id" -R "$repo" --log 2>/dev/null | grep -q "not released"; then
  echo "Build ${version:-?} was NOT released (workflows changed on main during it): a new build of main started by itself."
elif notes=$(gh release view "desktop-v$version" -R "$repo" --json body -q .body 2>/dev/null); then
  mac=$(grep -q '^Beta-approved:' <<<"$notes" && echo "approved" || echo "NOT approved")
  win=$(grep -q '^Beta-approved (Windows):' <<<"$notes" && echo "approved" || echo "NOT approved")
  echo "desktop-v${version}: Mac beta ${mac}, Windows beta ${win}. The run: ${run#* }"
else
  echo "Build ${version:-?} finished without a release: see ${run#* }"
fi
