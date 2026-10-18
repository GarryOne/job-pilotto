#!/usr/bin/env bash
# Prints the subject that names a PR: the newest commit that is not a "Move ..." split, else the newest (18 Oct 2026: #1375 was titled by its first commit, a required file split).
# Used by tools/ship-pr.sh (the title) and tools/pr-body.sh (the heading when there is no --body). Guarded by tests/test_ship_pr.py.   usage: tools/pr-title.sh [base]
base="${1:-origin/main}"
subjects="$(git log --format=%s "$base"..HEAD)"
printf '%s\n' "$subjects" | grep -v '^Move ' | head -n 1 | grep . || printf '%s\n' "$subjects" | head -n 1
