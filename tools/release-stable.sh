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

# The end-to-end journey (.github/workflows/e2e.yml: a new user through the wizard, a jobs check and the scores, on a real Mac) must be green.
# Its run for this build's commit if there is one, else the latest run on main; a run older than two days no longer vouches for anything.
# SKIP_E2E=1 promotes anyway (a hotfix while the journey itself is broken): say why in the release notes.
if [ "${SKIP_E2E:-0}" != 1 ]; then
  sha=$(gh api "repos/$repo/commits/$tag" -q .sha)
  runs=$(gh run list -R "$repo" --workflow=e2e.yml --branch main --status completed -L 15 --json conclusion,headSha,createdAt)
  verdict=$(printf '%s' "$runs" | jq -r --arg sha "$sha" '
    (map(select(.headSha == $sha))[0] // .[0]) as $run
    | if $run == null then "none"
      elif $run.conclusion != "success" then "red \($run.headSha[0:7])"
      elif (now - ($run.createdAt | fromdateiso8601)) > 172800 then "stale"
      else "green" end')
  case "$verdict" in
    green) echo "End-to-end journey: green." ;;
    none) echo "No finished end-to-end run on main yet. Run it: gh workflow run e2e.yml -R $repo (about 3 minutes), then promote. SKIP_E2E=1 overrides." >&2; exit 1 ;;
    stale) echo "The last green end-to-end run is over two days old. Run it again: gh workflow run e2e.yml -R $repo. SKIP_E2E=1 overrides." >&2; exit 1 ;;
    red*) echo "The end-to-end journey is RED (${verdict#red }): a new user would not get through the app. Fix it, or SKIP_E2E=1 to promote anyway." >&2; exit 1 ;;
  esac
fi

gh release edit "$tag" -R "$repo" --prerelease=false --latest
echo "Stable: $tag (friends' apps offer it within 10 minutes, or at their next start)"
