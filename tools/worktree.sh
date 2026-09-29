#!/bin/sh
# One worktree per task (AGENTS.md → Working with git), ready to test at once: the packages installed in the main
# checkout (desktop/, worker/, site/ node_modules) are linked in, not reinstalled (npm ci takes minutes for Electron).
# node_modules is git-ignored, link or folder: never committed, never removed by hand.
#   tools/worktree.sh <topic>          .claude/worktrees/<topic> on a new branch <topic> from origin/main
#   tools/worktree.sh --done <topic>   remove that worktree and its branch
set -eu
main=$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
if [ "${1:-}" = "--done" ]; then
  git -C "$main" worktree remove --force "$main/.claude/worktrees/$2"
  git -C "$main" branch -D "$2" >/dev/null
  echo "Removed $2"
  exit 0
fi
topic=${1:?usage: tools/worktree.sh <topic> | --done <topic>}
tree="$main/.claude/worktrees/$topic"
git -C "$main" fetch -q origin
git -C "$main" worktree add -q "$tree" -b "$topic" origin/main
for dir in desktop worker site; do
  if [ -d "$main/$dir/node_modules" ] && [ ! -e "$tree/$dir/node_modules" ]; then
    ln -s "$main/$dir/node_modules" "$tree/$dir/node_modules"
  fi
done
echo "$tree"
