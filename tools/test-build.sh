#!/usr/bin/env bash
# A test build for friends who switched on Settings → Diagnostics → Test builds: Mac and Windows are built from main and published as a pre-release,
# WITHOUT the e2e gate (a "Build only" run: desktop.yml, not beta). Their apps offer it at once; beta testers and everyone else are not offered it.
# Faster than tools/beta-release.sh, and unchecked: use it to get a fix to one person, then run the beta for everyone.
#   tools/test-build.sh
set -euo pipefail
repo=GarryOne/job-pilotto
gh workflow run desktop.yml -R "$repo" --ref main
sleep 5
gh run list -R "$repo" --workflow desktop.yml --event workflow_dispatch -L 3 --json databaseId,displayTitle,url \
  -q '[.[] | select(.displayTitle | startswith("Build only"))][0] | "Build only started: \(.url)"'
echo "When both lanes are green the build is a pre-release; test-channel apps offer it (Settings → Diagnostics → Update → Check now)."
