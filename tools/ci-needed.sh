#!/usr/bin/env bash
# A required CI job's first step (owner, 12 Oct 2026: "why do we run this test harness, if not relevant code has been changed"): can this pull request break the job?
# It writes run=true|false to $GITHUB_OUTPUT and prints why; the job's later steps run only on run=true, and the job still reports (a skipped step passes).
#   bash tools/ci-needed.sh <job>     (a job of tools/affected-jobs.py: python desktop worker site replays zoo replaygate)
# The answer is tools/affected-jobs.py on what the merge commit changes (HEAD^1..HEAD, checkout fetch-depth 2). Not a pull request (a push to main, a manual run: the
# backstop runs everything), no merge commit to compare, or the pick failing: the job runs. Guarded by tests/test_affected_jobs.py.
set -u
job="${1:?usage: tools/ci-needed.sh <job>}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
verdict="run: not a pull request: every job runs whole"
if [ "${GITHUB_EVENT_NAME:-}" = pull_request ]; then
  if ! git rev-parse -q --verify 'HEAD^2' >/dev/null; then
    verdict="run: HEAD is not the pull request's merge commit (checkout fetch-depth 2?): what it changes is unknown"
  else
    py=""   # the runner's own Python, before any setup step (Windows: python3 may be a store stub that only prints a hint)
    for candidate in python3 python; do "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1 && { py="$candidate"; break; }; done
    if [ -z "$py" ]; then verdict="run: no Python 3.9+ to ask the pick"
    elif answer="$("$py" tools/affected-jobs.py --job "$job" --base 'HEAD^1' 2>&1)"; then verdict="$(printf '%s\n' "$answer" | tail -n 1)"
    else verdict="run: the pick failed: $(printf '%s\n' "$answer" | tail -n 1)"; fi
  fi
fi
case "$verdict" in skip:*) run=false ;; *) run=true ;; esac
echo "$job: $verdict"
echo "run=$run" >>"$out"
