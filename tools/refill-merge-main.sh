#!/usr/bin/env bash
# The refill workflow's tree: the PR's head (already checked out) plus everything main has that it lacks, merged locally on the runner and never pushed (cc, 15 Oct 2026: PR #824 predated #835,
# so its merge ref had no refill-pick.mjs and no JP_REFILL_CI support in the app). The build under test stays the PR's; the harness and the refill tools are main's. A PR that does not merge
# with main stops here with the reason. Guard: tests/test_refill_merge_main.py.   Usage: tools/refill-merge-main.sh [<pr number>]
set -euo pipefail
remote="${REFILL_REMOTE:-origin}"; base="${REFILL_BASE:-main}"
git fetch --quiet "$remote" "$base"
head="$(git rev-parse --short HEAD)"
if ! git -c user.name=refill -c user.email=refill@invalid merge --no-edit --quiet "$remote/$base" >/dev/null 2>&1; then
  git merge --abort 2>/dev/null || true
  echo "refill: PR ${1:-?} (head $head) does not merge with $base: rebase it onto $base first (nothing was asked)" >&2
  exit 1
fi
echo "refill: PR ${1:-?} head $head + $base $(git rev-parse --short "$remote/$base")"
