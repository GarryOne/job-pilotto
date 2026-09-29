#!/usr/bin/env bash
# Promote a desktop build to the stable release: friends' apps offer it as an update ("Update to …" in the menu),
# and the website's download links serve it. Every push to main only makes a pre-release.
#   tools/release-stable.sh                 # the newest build
#   tools/release-stable.sh desktop-v0.4.0-alpha.42
set -euo pipefail
repo=GarryOne/job-pilotto
tag=${1:-$(gh release list -R "$repo" -L 20 --json tagName,isDraft -q '[.[] | select(.isDraft | not)][0].tagName')}
gh release view "$tag" -R "$repo" --json assets -q '.assets[].name' | grep -q 'windows-x64.exe' \
  || { echo "$tag has no Windows installer yet: wait for its build to finish." >&2; exit 1; }
gh release edit "$tag" -R "$repo" --prerelease=false --latest
echo "Stable: $tag (friends' apps offer it within 6 hours, or at their next start)"
