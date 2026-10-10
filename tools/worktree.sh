#!/bin/sh
# One worktree per task (AGENTS.md → Working with git), ready to test at once: the packages installed in the main
# checkout (desktop/, desktop/e2e/, worker/, site/ node_modules, and the Python .venv) are linked in, not reinstalled (npm ci takes minutes for Electron).
# node_modules is git-ignored, link or folder: never committed, never removed by hand.
#   tools/worktree.sh <topic> [<base>] .claude/worktrees/<topic> on a new branch <topic> from <base> (default origin/main;
#                                      e.g. origin/release/notion-optional: a release lane gets the same links)
#   tools/worktree.sh --done <topic>   remove that worktree and its branch
#   tools/worktree.sh prune [--yes]    landed worktrees: list (dry run) or remove (--yes) the folders under .claude/worktrees whose branch is fully on
#                                      origin/main and that nobody touched for 7 days (JP_PRUNE_DAYS); keeps the branch, keeps any worktree with uncommitted
#                                      or untracked work, and any worktree a running process sits in (owner, 11 Oct 2026: keep by default, prune landed ones)
set -eu
main=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
if [ "${1:-}" = "--done" ]; then
  git -C "$main" worktree remove --force "$main/.claude/worktrees/$2"
  git -C "$main" branch -D "$2" >/dev/null
  echo "Removed $2"
  exit 0
fi
if [ "${1:-}" = "prune" ]; then
  days=${JP_PRUNE_DAYS:-7}; yes=${2:-}
  git -C "$main" fetch -q origin
  live=$(lsof -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)   # every running process's working directory
  kept=0; gone=0
  git -C "$main" worktree list --porcelain | sed -n 's/^worktree //p' | while read -r tree; do
    case "$tree" in "$main/.claude/worktrees/"*) ;; *) continue ;; esac
    name=${tree#"$main/.claude/worktrees/"}
    head=$(git -C "$tree" rev-parse HEAD 2>/dev/null) || { echo "keep $name: not readable"; continue; }
    if ! git -C "$main" merge-base --is-ancestor "$head" origin/main && git -C "$main" cherry origin/main "$head" | grep -q '^+'; then echo "keep $name: commits not on main"; continue; fi
    if [ -n "$(git -C "$tree" status --porcelain --untracked-files=normal 2>/dev/null)" ]; then echo "keep $name: uncommitted or untracked work"; continue; fi
    if printf '%s\n' "$live" | grep -q -F -x -e "$tree" || printf '%s\n' "$live" | grep -q -F "$tree/"; then echo "keep $name: a running process is in it"; continue; fi
    if [ -n "$(find "$tree" -path '*/node_modules' -prune -o -newermt "-$days days" -print 2>/dev/null | head -1)" ]; then echo "keep $name: touched in the last $days days"; continue; fi
    if [ "$yes" = "--yes" ]; then git -C "$main" worktree remove --force "$tree" && echo "removed $name (branch kept)"; else echo "would remove $name (branch kept)"; fi
  done
  [ "$yes" = "--yes" ] || echo "dry run: tools/worktree.sh prune --yes removes the ones listed as \"would remove\""
  exit 0
fi
topic=${1:?usage: tools/worktree.sh <topic> [<base>] | --done <topic> | prune [--yes]}
base=${2:-origin/main}
tree="$main/.claude/worktrees/$topic"
git -C "$main" fetch -q origin
git -C "$main" worktree add -q "$tree" -b "$topic" "$base"
for dir in desktop desktop/e2e worker site; do
  if [ -d "$main/$dir/node_modules" ] && [ ! -e "$tree/$dir/node_modules" ]; then
    ln -s "$main/$dir/node_modules" "$tree/$dir/node_modules"
  fi
done
# The app runs the engine with <repo>/.venv/bin/python when it exists, else the system python3, which has no `anthropic`: every AI step then fails with
# "ModuleNotFoundError: No module named 'anthropic'" (seen in the Technical log of an e2e run from a worktree).
if [ -d "$main/.venv" ] && [ ! -e "$tree/.venv" ]; then
  ln -s "$main/.venv" "$tree/.venv"
fi
echo "$tree"
