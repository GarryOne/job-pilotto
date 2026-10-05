#!/usr/bin/env bash
# Land this worktree's branch on main in one command (AGENTS.md "Change tiers"). It does what the checklist did by hand, and retries the
# one thing that kept failing, a push rejected because another session pushed in between:
#   1. fetch + rebase on origin/main (conflicts: it stops and says so; keep both sides' work)
#   2. the push hook's checks, once: commit subjects, red main, and the suites of the areas this change touches
#   3. push (fast-forward only, never forced); rejected -> fetch, rebase, push again, up to 5 times
#   4. bring the main checkout up to date (unless it holds uncommitted edits to the same files), then remove this worktree
#   tools/ship.sh            Tier 0/1: only the touched areas' suites
#   tools/ship.sh --full     Tier 2: every suite (PUSH_FULL=1)
#   tools/ship.sh --fix      this commit is the fix or revert of a red main (CI_RED_OK=1)
#   tools/ship.sh --keep     leave the worktree and branch in place
set -euo pipefail
flags=""; keep=0
for arg in "$@"; do
  case "$arg" in
    --full) flags="PUSH_FULL=1 $flags" ;;
    --fix) flags="CI_RED_OK=1 $flags" ;;
    --keep) keep=1 ;;
    *) echo "usage: tools/ship.sh [--full] [--fix] [--keep]" >&2; exit 2 ;;
  esac
done

here="$(git rev-parse --show-toplevel)"
branch="$(git rev-parse --abbrev-ref HEAD)"
main="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
[ "$branch" != main ] || { echo "ship: this is the main checkout. Work in a worktree (tools/worktree.sh <topic>), then run this there." >&2; exit 2; }
if ! git diff --quiet || ! git diff --cached --quiet; then echo "ship: uncommitted changes in tracked files: commit them first" >&2; exit 2; fi

rebase() {
  git fetch -q origin
  if ! git rebase origin/main >/dev/null 2>&1; then
    git rebase --abort >/dev/null 2>&1 || true
    echo "ship: the rebase onto origin/main has conflicts. Resolve them keeping both sides' work, then run this again." >&2
    exit 1
  fi
}

rebase
[ "$(git rev-list --count origin/main..HEAD)" -gt 0 ] || { echo "ship: nothing to push, $branch has no commits beyond origin/main"; exit 0; }

# The hook is a Claude Code hook, so a script's own `git push` never meets it: run its checks here, once, as it would see the push.
payload="$(jq -n --arg command "${flags}git push origin $branch:main" --arg cwd "$here" '{tool_input: {command: $command}, cwd: $cwd}')"
bash "$here/tools/pre-push-check.sh" <<<"$payload" || exit $?

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

if [ "$keep" = 0 ]; then
  cd "$main"
  case "$here" in "$main"/.claude/worktrees/*) tools/worktree.sh --done "${here##*/}" ;; esac
fi
