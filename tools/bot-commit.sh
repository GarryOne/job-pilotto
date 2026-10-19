#!/usr/bin/env bash
# Commits for a workflow that opens a PR by itself (sentry-fix, ui-fix, finder-review, record-sites): the message carries the trailers the PR's Fast checks need. Guard: tests/test_bot_pr_checks.py.
#   tools/bot-commit.sh "<subject>" "<why no recorded page is needed>" [extra message paragraph]...   (the files are already staged)
# Co-Authored-By names the model that wrote the change; "Recorded-unneeded" is true because a workflow's change is proven by its own unit test and the suites, never by a page it saw fail (tools/recorded-cases.mjs).
set -euo pipefail
subject="${1:?usage: tools/bot-commit.sh <subject> <why-no-recorded-page> [paragraph]...}"; why="${2:?a reason for Recorded-unneeded}"; shift 2
args=(-m "$subject")
for paragraph in "$@"; do args+=(-m "$paragraph"); done
exec git commit -q "${args[@]}" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Pool-row: none a workflow change, no pool row behind it
Recorded-unneeded: $why"
