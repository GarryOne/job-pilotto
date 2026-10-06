#!/usr/bin/env bash
# Mark a pre-release as approved for beta testers: it passed the unit suites and every end-to-end suite on its own commit.
# Only approved builds are offered to people who switched on "Beta" in the app (desktop/lib/updater.js looks for the marker line
# in the release notes). It does NOT make the build stable: that is canary-promote.yml (more end-to-end runs, no blocking finding, healthy beta use).
#   tools/beta-approve.sh desktop-v0.5.3             Mac (and Linux): unit suites + every Mac/Linux end-to-end suite (e2e.yml promote)
#   tools/beta-approve.sh --windows desktop-v0.5.3   Windows: every Windows end-to-end suite (e2e-windows.yml). A Windows app takes a beta only with BOTH lines
#   (desktop/lib/updater.js; one release, one version: Windows users wait for their own suites, Mac users do not; owner, 6 Oct 2026).
set -euo pipefail
repo=GarryOne/job-pilotto
windows=''; if [ "${1:-}" = --windows ]; then windows=1; shift; fi
tag=${1:?usage: tools/beta-approve.sh [--windows] <tag>}
marker='Beta-approved:'; [ -n "$windows" ] && marker='Beta-approved (Windows):'
body=$(gh release view "$tag" -R "$repo" --json body -q .body)
if printf '%s\n' "$body" | grep -qF -- "$marker"; then echo "$tag is already approved ($marker)."; exit 0; fi
sha=$(gh api "repos/$repo/commits/$tag" -q '.sha[0:7]')
line="$marker unit suites and every end-to-end suite passed on commit $sha ($(date -u +%Y-%m-%d))"
[ -n "$windows" ] && line="$marker every Windows end-to-end suite passed on commit $sha ($(date -u +%Y-%m-%d))"
gh release edit "$tag" -R "$repo" --notes "$(printf '%s\n\n%s' "$body" "$line")"
echo "$tag: $line"
python3 "$(dirname "${BASH_SOURCE[0]}")/sync_release_labels.py" || echo "(release labels not refreshed: run tools/sync_release_labels.py)"
