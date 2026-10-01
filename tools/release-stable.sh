#!/usr/bin/env bash
# Promote a desktop build to the stable release: friends' apps offer it as an update ("Update to …" in the menu),
# and the website's download links serve it. Every push to main only makes a pre-release.
#   tools/release-stable.sh                 # the newest build
#   tools/release-stable.sh desktop-v0.4.0-alpha.42
set -euo pipefail
repo=GarryOne/job-pilotto
tag=${1:-$(gh release list -R "$repo" -L 20 --json tagName,isDraft -q '[.[] | select(.isDraft | not)][0].tagName')}

# The Windows installer must be THIS build's own. When the windows job fails, desktop.yml's mac-only fallback
# uploads the previous release's generic Job-Pilotto-windows-x64.exe, so the release looks promotable while its
# Windows app is an older version (30 Sep 2026: alpha.131-133 shipped that way). A generic name alone proves
# nothing; the versioned installer beside it, the same bytes, does.
version=${tag#desktop-v}
assets=$(gh release view "$tag" -R "$repo" --json assets -q '.assets[] | "\(.name)\t\(.size)"')
size_of() { printf '%s\n' "$assets" | awk -F'\t' -v want="$1" '$1 == want {print $2; exit}'; }
generic=$(size_of 'Job-Pilotto-windows-x64.exe')
own=$(size_of "Job-Pilotto-${version}-x64.exe")
[ -n "$generic" ] || { echo "$tag has no Windows installer yet: wait for its build to finish." >&2; exit 1; }
[ -n "$own" ] || { echo "$tag carries no installer of its own (Job-Pilotto-${version}-x64.exe): its Windows build
failed and the previous release's installer was carried over. Promote a build whose Windows job passed." >&2; exit 1; }
[ "$own" = "$generic" ] || { echo "$tag's Windows installer is not the one its build made: Job-Pilotto-${version}-x64.exe
is ${own} bytes, Job-Pilotto-windows-x64.exe is ${generic}. Promote a build whose Windows job passed." >&2; exit 1; }

gh release edit "$tag" -R "$repo" --prerelease=false --latest
echo "Stable: $tag (friends' apps offer it within 6 hours, or at their next start)"
