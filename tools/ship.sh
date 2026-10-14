#!/usr/bin/env bash
# Land this worktree's branch on main in one command (AGENTS.md "Change tiers"). It does what the checklist did by hand, and retries the
# one thing that kept failing, a push rejected because another session pushed in between:
#   1. fetch + rebase on origin/main (conflicts: it stops and says so; keep both sides' work)
#   2. the push hook's checks, once: commit subjects, red main, and the suites of the areas this change touches
#   3. push (fast-forward only, never forced); rejected -> fetch, rebase, re-check only if what landed can clash (tools/recheck-needed.py), push again, up to 5 times
#   4. bring the main checkout up to date (unless it holds uncommitted edits to the same files); the worktree is kept (tools/worktree.sh prune removes old landed ones)
#   tools/ship.sh            Tier 0/1: only the touched areas' suites
#   tools/ship.sh --full     Tier 2: every suite (PUSH_FULL=1)
#   tools/ship.sh --fix      this commit is the fix or revert of a red main (CI_RED_OK=1)
#   tools/ship.sh --keep     accepted, does nothing (keeping is the default since 11 Oct 2026)
#   tools/ship.sh --remove   remove the worktree and its branch after landing (the old default)
#   tools/ship.sh --body=<file>  the PR's 5-second summary (a verdict line, short bullets, a before/after table): tools/pr-body.sh puts it on top
#   tools/ship.sh --background   start detached and return at once (the checks can take minutes): follow the log it names
# Every run writes its whole output to a log (the first line names it; SHIP_LOG=<file> chooses it), shows each step with the seconds since
# the start, and ends with exactly one marker line: `ship: DONE <sha>` (merged), `ship: REVIEW #n <url>` (owner reviews by hand: open, checks green) or `ship: FAILED (exit N) ...`. A caller that cut the run short
# (a timeout, a piped `| tail`) reads that last line of the log to know how it ended; running it again is safe.
set -euo pipefail
flags=""; keep=1; background=0; args=()
for arg in "$@"; do
  case "$arg" in
    --full) flags="PUSH_FULL=1 $flags"; args+=("$arg") ;;
    --fix) flags="CI_RED_OK=1 $flags"; export JOB_PILOTTO_RED_FIX=1; args+=("$arg") ;;   # the fix of a red main goes first: no landing queue, no check-slot wait, heavy-lock class fix
    --keep) keep=1; args+=("$arg") ;;
    --remove) keep=0; args+=("$arg") ;;
    --background) background=1 ;;
    --body=*) SHIP_PR_BODY="$(cd "$(dirname "${arg#--body=}")" && pwd)/$(basename "${arg#--body=}")"; export SHIP_PR_BODY; [ -s "$SHIP_PR_BODY" ] || { echo "ship: --body file is empty or missing: ${arg#--body=}" >&2; exit 2; }; args+=("$arg") ;;   # the PR's 5-second summary (tools/pr-body.sh)
    *) echo "usage: tools/ship.sh [--full] [--fix] [--keep|--remove] [--background] [--body=<file>]" >&2; exit 2 ;;
  esac
done

here="$(git rev-parse --show-toplevel)"
git config core.hooksPath tools/githooks 2>/dev/null || true   # the commit-msg hook (trailer values) for every worktree of this repo; the setting is shared and relative
branch="$(git rev-parse --abbrev-ref HEAD)"
main="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
[ "$branch" != main ] || { echo "ship: this is the main checkout. Work in a worktree (tools/worktree.sh <topic>), then run this there." >&2; exit 2; }
if ! git diff --quiet || ! git diff --cached --quiet; then echo "ship: uncommitted changes in tracked files: commit them first" >&2; exit 2; fi

log="${SHIP_LOG:-${TMPDIR:-/tmp}/ship-${branch//\//-}.log}"
[ -f "$here/tools/session-name.sh" ] && source "$here/tools/session-name.sh" || session_name() { echo "${JOB_PILOTTO_SESSION:-?}"; }
if [ "$background" = 1 ]; then
  export JOB_PILOTTO_SESSION="$(session_name)"   # the detached run has no Claude session among its parents any more
  : > "$log"
  # Its own session (setsid; macOS has no such command, python's os.setsid does the same): the caller's process-group kill or hangup when its
  # call ends (a tool timeout, a closed terminal) must not reach the run. nohup alone only ignores SIGHUP (10 Oct 2026: a killed run logged DONE).
  if command -v setsid >/dev/null; then
    SHIP_LOG="$log" setsid "$0" ${args[@]+"${args[@]}"} > /dev/null 2>&1 < /dev/null &   # the child's own tee writes the log
  else
    SHIP_LOG="$log" python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$0" ${args[@]+"${args[@]}"} > /dev/null 2>&1 < /dev/null &
  fi
  echo "ship: started in the background (pid $!). Log: $log"
  echo "ship: its last line says how it ended: 'ship: DONE <sha>' (merged), 'ship: REVIEW #n <url>' (green, the owner merges) or 'ship: FAILED ...'; Monitor ^ship: (DONE|FAILED|REVIEW) (e.g. tail -3 $log)"
  exit 0
fi
# From here every line also goes to the log; the exit trap writes the closing marker once. SHIP_LOG is not passed on to the commands below
# (the suites run a nested ship.sh of their own).
unset SHIP_LOG
: >>"$log"   # the log exists before tee starts: the timeline reads it at once (12 Oct 2026, CI: a new log not yet made by tee ended the landing under set -e)
exec > >(tee -a "$log") 2> >(tee -a "$log" >&2)
echo "ship: log: $log"
started=$SECONDS
if [ -f "$here/tools/landing-lock.sh" ]; then source "$here/tools/landing-lock.sh"; else landing_acquire() { :; }; landing_release() { :; }; fi   # a queue only with SHIP_LANDING_LOCK=1 (off by default: a refused push rebases and re-runs the checks)
if [ -f "$here/tools/ship-timeline.sh" ]; then source "$here/tools/ship-timeline.sh"; timeline_begin "$log"; else timeline_mark() { :; }; timeline_write() { :; }; fi   # one line per landing in ship-timeline.log
if [ -f "$here/tools/ship-pr.sh" ]; then source "$here/tools/ship-pr.sh"; else ship_mode() { echo direct; }; fi   # landing through a pull request with auto-merge (12 Oct 2026); any other origin pushes to main as before
if [ -f "$here/tools/ship-red.sh" ]; then source "$here/tools/ship-red.sh"; else ship_red_gate() { :; }; fi   # while main is red every landing but the fix waits (tools/red-main.sh)
step() { timeline_mark "$*"; echo "ship: [$((SECONDS - started))s] $*"; }
# DONE is printed only by a run that reached one of its two real ends (`finished=1`: pushed, or deliberately nothing to push). A signal exits non-zero
# and stops the push checks it started; an exit 0 that never got to an end is reported as such, never as DONE (10 Oct 2026: a killed background run logged
# "DONE nothing to push" with its commit unpushed).
finished=""; check_pid=""; fail_reason=""
killtree() { local child; for child in $(pgrep -P "$1" 2>/dev/null); do killtree "$child"; done; kill "$1" 2>/dev/null; return 0; }   # the checks start suites of their own
on_signal() { echo "ship: stopped by signal $1" >&2; [ -n "$check_pid" ] && killtree "$check_pid"; exit $((128 + $2)); }
trap 'on_signal TERM 15' TERM
trap 'on_signal INT 2' INT
trap 'on_signal HUP 1' HUP
trap 'code=$?; landing_release; timeline_write "$code"; if [ "$code" -ne 0 ]; then echo "ship: FAILED ${fail_reason:-(exit $code)}, log: $log"; elif [ -n "${review_n:-}" ]; then echo "ship: REVIEW #$review_n ${review_url:-} (every check green; the owner reviews and merges)"; elif [ -n "$finished" ]; then echo "ship: DONE ${sha:-nothing to push}"; else echo "ship: FAILED (ended early without pushing or finishing), log: $log"; fi' EXIT

# Several sessions fetch into one shared repo: a fetch can lose the race for a ref lock ("cannot lock ref 'refs/remotes/origin/main'", 12 Oct 2026, a merged PR reported FAILED). Try again.
ship_fetch() { local try; for try in 1 2 3 4 5; do git fetch -q origin 2>/dev/null && return 0; sleep 1; done; git fetch -q origin; }
rebase() {
  ship_fetch
  git config merge.ladder-baseline.driver 'node tools/merge-baseline.mjs %O %A %B'   # two sessions' ladder-baseline updates merge (.gitattributes)
  if ! git rebase origin/main >/dev/null 2>&1; then
    git rebase --abort >/dev/null 2>&1 || true
    echo "ship: the rebase onto origin/main has conflicts. Resolve them keeping both sides' work, then run this again." >&2
    exit 1
  fi
}
# The extension's version is no longer taken here: the build stamps it (desktop/scripts/extension-stamp.mjs, 13 Oct 2026).

# The landing queue (owner, 11 Oct 2026): a landing that runs the slow gates (it changes a file they read: the gate paths of pre-push-check.sh) waits
# for the landings ahead of it, so it checks once on the main it will push to; three such landings at once refused each other's pushes and re-ran
# 10-20 min of checks up to three times for one commit. Other landings (docs, site, tools) go straight through. A refused push still rebases and
# re-checks. SHIP_LANDING_LOCK=1 always queues, =0 never.
# A landing through a pull request never queues (owner, 12 Oct 2026: "Everybody can open PR at any time"): the PR's required checks guard main,
# and the queue was held until the PR merged (~4 min), so PRs waited for each other again. Guard: tests/test_ship_pr.py.
mode="$(ship_mode)"
slow_gate_paths="extension desktop/lib desktop/test desktop/e2e desktop/scripts desktop/package.json desktop/package-lock.json worker/src docs/flows"
case "${SHIP_LANDING_LOCK:-auto}" in
  1) queue=1 ;; 0) queue=0 ;;
  *) if [ "${JOB_PILOTTO_RED_FIX:-}" = 1 ] || [ "$mode" = pr ]; then queue=0; else git fetch -q origin; if [ -n "$(git diff --name-only origin/main...HEAD -- $slow_gate_paths 2>/dev/null)" ]; then queue=1; else queue=0; fi; fi ;;
esac
if [ "$queue" = 1 ]; then
  step "queueing for the landing lock (this landing runs the slow gates; SHIP_LANDING_LOCK=0 skips the queue)"
  landing_acquire "$branch"
fi
step "rebasing $branch onto origin/main"
rebase
[ "$(git rev-list --count origin/main..HEAD)" -gt 0 ] || { echo "ship: nothing to push, $branch has no commits beyond origin/main"; finished=1; exit 0; }

ship_red_gate "before the checks"
# The hook is a Claude Code hook, so a script's own `git push` never meets it: run its checks here as it would see the push (again after a refused push).
if [ "$mode" = pr ]; then push_command="${flags}SHIP_PR=1 git push origin $branch"; else push_command="${flags}git push origin $branch:main"; fi   # SHIP_PR=1: the hook runs only its fast pure checks, CI runs the rest on the PR
payload="$(jq -n --arg command "$push_command" --arg cwd "$here" '{tool_input: {command: $command}, cwd: $cwd}')"
# It prints nothing while it passes and takes minutes: a heartbeat every 20 s says it is still working; its own words show only on failure.
run_checks() {  # [why]
  step "running the push checks${1:+ $1} ($([ "$mode" = pr ] && echo 'the fast pure checks; CI runs the suites on the PR' || echo 'the suites of the touched areas'); ${flags:+$flags}this can take a few minutes)"
  checks="$(mktemp)"
  bash "$here/tools/pre-push-check.sh" <<<"$payload" > "$checks" 2>&1 &
  check_pid=$!
  while kill -0 "$check_pid" 2>/dev/null; do
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do kill -0 "$check_pid" 2>/dev/null || break; sleep 1; done
    kill -0 "$check_pid" 2>/dev/null && step "the push checks are still running"
  done
  check_code=0; wait "$check_pid" || check_code=$?
  cat "$checks" >&2; rm -f "$checks"
  [ "$check_code" = 0 ] || exit "$check_code"
  step "the push checks passed"
}
checked_base="$(git merge-base HEAD origin/main)"   # the main these commits were rebased on and are checked against; the push gate fetches origin itself, so origin/main is no "before"
run_checks

# A push that changes workflow files while a desktop build runs would make GitHub refuse that build's release, if the build could not tag at its
# start (desktop.yml "Tag this build now"): wait until the build has tagged itself, not for the whole build (tools/wait-build-tag.sh; 11 Oct 2026; it was up
# to 20 minutes). SHIP_NO_WAIT=1 skips the wait, SHIP_WAIT_FOR_BUILD=1 waits for the whole build as before. Other pushes never wait.
if [ -z "${SHIP_NO_WAIT:-}" ] && ! git diff --quiet origin/main HEAD -- .github/workflows 2>/dev/null; then
  if [ -f "$here/tools/wait-build-tag.sh" ]; then bash "$here/tools/wait-build-tag.sh"; fi
fi

ship_red_gate "before the push"
if [ "$mode" = pr ]; then
  ship_pr_land
  if [ -n "${review_n:-}" ]; then finished=1; exit 0; fi   # review mode (owner, 12 Oct 2026): the PR is open with green checks; nothing landed on main, so no checkout to update
else
  step "pushing to main"
  pushed=""
  for attempt in 1 2 3 4 5; do
    before="$(git rev-parse origin/main)"
    if out="$(git push origin HEAD:main 2>&1)"; then pushed=1; break; fi
    [ "$attempt" -lt 5 ] || break   # the last push was refused: no rebase and no checks for a push that will not come
    echo "ship: push rejected, main moved ($attempt/5): fetching and rebasing again" >&2
    rebase
    # The checks run again only when what just landed can clash with this landing (tools/recheck-needed.py: a shared file, the checks' own files, a test both
    # sides run, ...). Otherwise the push goes at once and CI is the net: a bad combination shows as a red main (11 Oct 2026: 18 refusals a day, median 78 s each).
    # SHIP_RECHECK=1 re-runs the checks after every refusal, as before.
    verdict="recheck: SHIP_RECHECK=1"
    if [ -z "${SHIP_RECHECK:-}" ]; then
      verdict="$(python3 -I "$here/tools/recheck-needed.py" --mine $(git diff --name-only origin/main HEAD) --incoming $(git diff --name-only "$checked_base" origin/main) 2>&1)" || [ $? = 1 ] || verdict="recheck: the decision tool failed"
    fi
    case "$verdict" in
      skip:*) step "not re-running the checks (SHIP_RECHECK=1 re-runs them): ${verdict#skip: }" ;;
      *) checked_base="$(git merge-base HEAD origin/main)"; run_checks "again, on the new main (${verdict#recheck: })" ;;   # the combination with what just landed is checked before it is pushed
    esac
    [ "${GATE_TIMING:-1}" = 0 ] || echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) refused push recheck=${verdict%%:*} why=${verdict#*: }" >>"$(git rev-parse --path-format=absolute --git-common-dir)/gate-timing.log"
  done
  [ -n "$pushed" ] || { echo "ship: still rejected after 5 tries:" >&2; echo "$out" | tail -3 >&2; exit 1; }
  sha="$(git rev-parse --short HEAD)"
  files="$(git diff --name-only "$before" HEAD)"
  echo "ship: pushed $sha to main: $(git log -1 --format=%s)"
fi

# Bring the main checkout up to date, unless a session left uncommitted edits to a file this push changed.
if [ "$(git -C "$main" rev-parse --abbrev-ref HEAD)" = main ]; then
  dirty="$(git -C "$main" status --porcelain --untracked-files=no | sed -E 's/^.{3}//' | sort)"
  overlap="$(comm -12 <(printf '%s\n' "$dirty") <(printf '%s\n' "$files" | sort))"
  if [ -n "$overlap" ]; then
    echo "ship: NOT updating the main checkout: it has uncommitted edits to files this push changed (leave them; update it yourself later):" >&2
    printf '  %s\n' $overlap >&2
  elif git -C "$main" pull -q --ff-only origin main; then
    [ "$(git -C "$main" rev-parse HEAD)" = "$(git -C "$main" rev-parse origin/main)" ] && echo "ship: main checkout is on $sha, in sync with origin/main"
  else
    echo "ship: the main checkout could not fast-forward; look at it" >&2
  fi
else
  echo "ship: the main checkout is on another branch, not updated" >&2
fi

finished=1
if [ "$keep" = 0 ]; then
  cd "$main"
  case "$here" in "$main"/.claude/worktrees/*) tools/worktree.sh --done "${here##*/}" ;; esac
fi
