#!/usr/bin/env bash
# The replay gate's baseline: the newest green scheduled replay on main that kept its results (replay-offline.yml "replay-results-<run>"), downloaded into <dir>.
# Prints its results.json path, or "-" when there is none yet. bash replay-baseline.sh <dir>. Needs GH_TOKEN, GITHUB_REPOSITORY. Used by .github/workflows/replay-pr.yml.
set -u
dir="${1:?usage: replay-baseline.sh <dir>}"; mkdir -p "$dir"
for base in $(gh run list -R "$GITHUB_REPOSITORY" --workflow replay-offline.yml --branch main --status success --limit 20 --json databaseId --jq '.[].databaseId'); do
  if gh run download "$base" -R "$GITHUB_REPOSITORY" --name "replay-results-$base" --dir "$dir" >/dev/null 2>&1; then echo "baseline: run $base" >&2; echo "$dir/results.json"; exit 0; fi
done
echo "baseline: none yet" >&2; echo -
