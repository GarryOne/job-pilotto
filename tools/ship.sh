#!/usr/bin/env bash
# Land this worktree's branch on main in one command (AGENTS.md "Change tiers"). It does what the checklist did by hand, and retries the
# one thing that kept failing, a push rejected because another session pushed in between:
#   1. fetch + rebase on origin/main (conflicts: it stops and says so; keep both sides' work)
#   2. the push hook's checks, once: commit subjects, red main, and the suites of the areas this change touches
#   3. push (fast-forward only, never forced); rejected -> fetch, rebase, push again, up to 5 times
#   4. bring the main checkout up to date (unless it holds uncommitted edits to the same files); the worktree is kept (tools/worktree.sh prune removes old landed ones)
#   tools/ship.sh            Tier 0/1: only the touched areas' suites
#   tools/ship.sh --full     Tier 2: every suite (PUSH_FULL=1)
#   tools/ship.sh --fix      this commit is the fix or revert of a red main (CI_RED_OK=1)
#   tools/ship.sh --keep     accepted, does nothing (keeping is the default since 11 Oct 2026)
#   tools/ship.sh --remove   remove the worktree and its branch after landing (the old default)
#   tools/ship.sh --background   start detached and return at once (the checks can take minutes): follow the log it names
# Every run writes its whole output to a log (the first line names it; SHIP_LOG=<file> chooses it), shows each step with the seconds since
# the start, and ends with exactly one marker line: `ship: DONE <sha>` or `ship: FAILED (exit N) ...`. A caller that cut the run short
# (a timeout, a piped `| tail`) reads that last line of the log to know how it ended; running it again is safe.
set -euo pipefail
flags=""; keep=1; background=0; args=()
for arg in "$@"; do
  case "$arg" in
    --full) flags="PUSH_FULL=1 $flags"; args+=("$arg") ;;
    --fix) flags="CI_RED_OK=1 $flags"; args+=("$arg") ;;
    --keep) keep=1; args+=("$arg") ;;
    --remove) keep=0; args+=("$arg") ;;
    --background) background=1 ;;
    *) echo "usage: tools/ship.sh [--full] [--fix] [--keep|--remove] [--background]" >&2; exit 2 ;;
  esac
done

here="$(git rev-parse --show-toplevel)"
branch="$(git rev-parse --abbrev-ref HEAD)"
main="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
[ "$branch" != main ] || { echo "ship: this is the main checkout. Work in a worktree (tools/worktree.sh <topic>), then run this there." >&2; exit 2; }
if ! git diff --quiet || ! git diff --cached --quiet; then echo "ship: uncommitted changes in tracked files: commit them first" >&2; exit 2; fi

log="${SHIP_LOG:-${TMPDIR:-/tmp}/ship-${branch//\//-}.log}"
if [ "$background" = 1 ]; then
  : > "$log"
  # Its own session (setsid; macOS has no such command, python's os.setsid does the same): the caller's process-group kill or hangup when its
  # call ends (a tool timeout, a closed terminal) must not reach the run. nohup alone only ignores SIGHUP (10 Oct 2026: a killed run logged DONE).
  if command -v setsid >/dev/null; then
    SHIP_LOG="$log" setsid "$0" ${args[@]+"${args[@]}"} > /dev/null 2>&1 < /dev/null &   # the child's own tee writes the log
  else
    SHIP_LOG="$log" python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$0" ${args[@]+"${args[@]}"} > /dev/null 2>&1 < /dev/null &
  fi
  echo "ship: started in the background (pid $!). Log: $log"
  echo "ship: its last line says how it ended: 'ship: DONE <sha>' or 'ship: FAILED ...' (e.g. tail -3 $log)"
  exit 0
fi
# From here every line also goes to the log; the exit trap writes the closing marker once. SHIP_LOG is not passed on to the commands below
# (the suites run a nested ship.sh of their own).
unset SHIP_LOG
exec > >(tee -a "$log") 2> >(tee -a "$log" >&2)
echo "ship: log: $log"
started=$SECONDS
if [ -f "$here/tools/landing-lock.sh" ]; then source "$here/tools/landing-lock.sh"; else landing_acquire() { :; }; landing_release() { :; }; fi   # one landing at a time, in arrival order
step() { echo "ship: [$((SECONDS - started))s] $*"; }
# DONE is printed only by a run that reached one of its two real ends (`finished=1`: pushed, or deliberately nothing to push). A signal exits non-zero
# and stops the push checks it started; an exit 0 that never got to an end is reported as such, never as DONE (10 Oct 2026: a killed background run logged
# "DONE nothing to push" with its commit unpushed).
finished=""; check_pid=""
killtree() { local child; for child in $(pgrep -P "$1" 2>/dev/null); do killtree "$child"; done; kill "$1" 2>/dev/null; return 0; }   # the checks start suites of their own
on_signal() { echo "ship: stopped by signal $1" >&2; [ -n "$check_pid" ] && killtree "$check_pid"; exit $((128 + $2)); }
trap 'on_signal TERM 15' TERM
trap 'on_signal INT 2' INT
trap 'on_signal HUP 1' HUP
trap 'code=$?; landing_release; if [ "$code" -ne 0 ]; then echo "ship: FAILED (exit $code), log: $log"; elif [ -n "$finished" ]; then echo "ship: DONE ${sha:-nothing to push}"; else echo "ship: FAILED (ended early without pushing or finishing), log: $log"; fi' EXIT

rebase() {
  git fetch -q origin
  git config merge.ladder-baseline.driver 'node tools/merge-baseline.mjs %O %A %B'   # two sessions' ladder-baseline updates merge (.gitattributes)
  git config merge.ext-manifest.driver 'node tools/merge-extension-version.mjs %O %A %B'   # a moved extension version is no conflict: it is taken below
  git config merge.ext-fingerprint.driver 'true'   # the upstream's fingerprint stays; it is written once below
  if ! git rebase origin/main >/dev/null 2>&1; then
    git rebase --abort >/dev/null 2>&1 || true
    echo "ship: the rebase onto origin/main has conflicts. Resolve them keeping both sides' work, then run this again." >&2
    exit 1
  fi
  take_extension_version
}
# The extension version and its fingerprint are taken HERE, after the rebase and while this landing holds the lock (spec faster-fixes §6): the next free
# version after main's, written once, amended into the last commit. SHIP_EXT_VERSION=0 leaves the branch's own version and fingerprint alone.
take_extension_version() {
  [ "${SHIP_EXT_VERSION:-1}" = 0 ] && return 0
  [ -f tools/extension-version-bump.mjs ] && [ -f desktop/scripts/extension-fingerprint.mjs ] || return 0
  local decided
  decided="$(node tools/extension-version-bump.mjs --base origin/main)" || { echo "ship: could not take the extension version ($decided)" >&2; exit 1; }
  case "$decided" in *'"action":"none"'*) return 0 ;; esac
  git add extension/manifest.json extension/fingerprint.json
  if git diff --cached --quiet; then step "extension version already right: $decided"; else git commit -q --amend --no-edit && step "extension version taken: $decided"; fi
}

step "queueing for the landing lock"
landing_acquire "$branch"
step "rebasing $branch onto origin/main"
rebase
[ "$(git rev-list --count origin/main..HEAD)" -gt 0 ] || { echo "ship: nothing to push, $branch has no commits beyond origin/main"; finished=1; exit 0; }

# The hook is a Claude Code hook, so a script's own `git push` never meets it: run its checks here, once, as it would see the push.
payload="$(jq -n --arg command "${flags}git push origin $branch:main" --arg cwd "$here" '{tool_input: {command: $command}, cwd: $cwd}')"
# It prints nothing while it passes and takes minutes: a heartbeat every 20 s says it is still working; its own words show only on failure.
step "running the push checks (the suites of the touched areas; ${flags:+$flags}this can take a few minutes)"
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

# A push that changes workflow files while a desktop build runs would make GitHub refuse that build's release, if the build could not tag at its
# start (desktop.yml "Tag this build now"): wait for the build, up to 20 minutes (SHIP_NO_WAIT=1 skips the wait). Other pushes never wait.
if [ -z "${SHIP_NO_WAIT:-}" ] && ! git diff --quiet origin/main HEAD -- .github/workflows 2>/dev/null; then
  for wait in $(seq 1 40); do
    running="$(gh run list -R GarryOne/job-pilotto --workflow desktop.yml --status in_progress -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
    [ -z "$running" ] && break
    [ "$wait" = 1 ] && echo "ship: this push changes workflow files and desktop build $running is running: waiting for it (at most 20 min)" >&2
    sleep 30
  done
fi

step "pushing to main"
pushed=""
for attempt in 1 2 3 4 5; do
  before="$(git rev-parse origin/main)"
  if out="$(git push origin HEAD:main 2>&1)"; then pushed=1; break; fi
  echo "ship: push rejected, main moved ($attempt/5): fetching and rebasing again" >&2
  rebase
done
[ -n "$pushed" ] || { echo "ship: still rejected after 5 tries:" >&2; echo "$out" | tail -3 >&2; exit 1; }
sha="$(git rev-parse --short HEAD)"
files="$(git diff --name-only "$before" HEAD)"
echo "ship: pushed $sha to main: $(git log -1 --format=%s)"

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
