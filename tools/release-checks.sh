#!/usr/bin/env bash
# The release checks every platform's beta approval shares (e2e.yml promote for Mac/Linux, e2e-windows.yml approve-windows): the unit suites are green on the
# commit, and (soak on) the Notion schema is additive over the current stable. Each platform's own end-to-end suites are checked by its own job.
#   tools/release-checks.sh <tag> <commit sha>      exit 1, with the reason on stdout, when the build must not be offered
set -euo pipefail
tag=${1:?usage: tools/release-checks.sh <tag> <sha>}; ref=${2:?usage: tools/release-checks.sh <tag> <sha>}
repo=${GITHUB_REPOSITORY:-GarryOne/job-pilotto}

verdict=$(gh run list -R "$repo" --workflow build.yml --commit "$ref" --status completed --json conclusion | python3 "$(dirname "${BASH_SOURCE[0]}")/e2e_gate.py" ci)
echo "build.yml on ${ref:0:7}: $verdict"
if [ "$verdict" != green ]; then echo "$tag stays a pre-release: build.yml is not green on its commit."; exit 1; fi

# The schema is additive over the current stable, so "Back to stable" cannot split anybody's data.
if [ "${JOB_PILOTTO_SOAK:-}" = on ]; then
  stable=$(gh release list -R "$repo" -L 20 --json tagName,isPrerelease,isDraft -q '[.[] | select(.isDraft | not) | select(.isPrerelease | not)][0].tagName')
  if [ -z "$stable" ] || [ "$stable" = "$tag" ]; then echo "No older stable to compare the schema with."; exit 0; fi
  tmp=$(mktemp -d)
  gh api "repos/$repo/contents/config/notion_schema.json?ref=$stable" -q .content | base64 -d > "$tmp/stable-schema.json"
  gh api "repos/$repo/contents/config/notion_schema.json?ref=$tag" -q .content | base64 -d > "$tmp/candidate-schema.json"
  status=0
  echo "Schema $tag vs stable $stable:"
  python3 "$(dirname "${BASH_SOURCE[0]}")/check_schema_additive.py" "$tmp/stable-schema.json" "$tmp/candidate-schema.json" || status=$?
  if [ "$status" != 0 ]; then echo "$tag is not offered to beta testers: it changes the Notion schema in a way the older app cannot undo."; exit 1; fi
fi
