#!/usr/bin/env bash
# The fast push checks for a repo shipped with this checkout's tools but without its own toolkit (the private job-pilotto-site): commit subjects. Its CI runs the suites.
# Usage: ship-private-checks.sh [base-ref]   (run inside that repo's worktree; default base origin/main)
set -uo pipefail
base="${1:-origin/main}"
bad=0
while IFS= read -r subject; do
  if [ "${#subject}" -gt 72 ]; then echo "ship: commit subject is ${#subject} characters, at most 72 (details go in the body): $subject" >&2; bad=1; fi
done < <(git log --format=%s "$base"..HEAD)
exit "$bad"
