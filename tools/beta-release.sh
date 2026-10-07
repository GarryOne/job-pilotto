#!/usr/bin/env bash
# A beta by hand, in one shot: build main now, then the same gate as the nightly approves it for beta testers.
#   build (desktop.yml -f beta=true, named "Beta build": always builds)
#   -> e2e.yml runs every gate suite on the build's commit (plan-run.mjs gates "Nightly build" and "Beta build")
#   -> promote job: unit suites green, no high-severity finding, additive Notion schema -> tools/beta-approve.sh
# Any red step leaves it a pre-release that nobody is offered. Never call tools/beta-approve.sh by hand: it skips the gate.
#   tools/beta-release.sh
set -euo pipefail
repo=GarryOne/job-pilotto
gh workflow run desktop.yml -R "$repo" --ref main -f beta=true
sleep 5
run=$(gh run list -R "$repo" --workflow desktop.yml --event workflow_dispatch -L 5 --json databaseId,displayTitle,url \
  -q '[.[] | select(.displayTitle == "Beta build")][0] | "\(.databaseId) \(.url)"')
echo "Beta build started: ${run#* }"
# Watched to the end (7 Oct 2026: a refused release went unnoticed): which version it published, or why not. --no-watch returns at once.
if [ "${1:-}" = "--no-watch" ]; then
  echo "The e2e gate starts by itself when it finishes (gh run list -R $repo --workflow e2e.yml -L 3); a pass adds 'Beta-approved:' to the release notes."
  exit 0
fi
id=${run%% *}
gh run watch "$id" -R "$repo" --interval 30 >/dev/null 2>&1 || true
version=$(gh run view "$id" -R "$repo" --log 2>/dev/null | sed -n 's/.*Releasing \([0-9.]*\).*/\1/p' | head -1)
if gh run view "$id" -R "$repo" --log 2>/dev/null | grep -q "not released"; then
  echo "Build ${version:-?} was NOT released (workflows changed on main during it): a new build of main started by itself."
elif gh release view "desktop-v$version" -R "$repo" >/dev/null 2>&1; then
  echo "Published ${version} as a test build. The e2e gate runs now (gh run list -R $repo --workflow e2e.yml -L 3); a pass makes it the beta."
else
  echo "Build ${version:-?} finished without a release: see ${run#* }"
fi
