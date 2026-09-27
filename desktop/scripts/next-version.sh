#!/usr/bin/env bash
# The version for the next desktop release, from desktop/package.json and the existing desktop-v* tags.
#   "0.2.0-alpha" (a pre-release label) -> 0.2.0-alpha.1, then .2, .3 … one per release
#   "0.2.0"       (a plain version)     -> 0.2.0, then 0.2.1, 0.2.2 … (patch counts up)
# Change the phase or target by editing package.json's version: 0.3.0-alpha, 0.3.0-beta, 1.0.0.
set -euo pipefail
cd "$(dirname "$0")/.."
base=$(node -p "require('./package.json').version")
tags=$(git tag -l 'desktop-v*')
if [[ "$base" == *-* ]]; then
  prefix="$base."
  last=$(printf '%s\n' "$tags" | sed -n "s/^desktop-v${prefix//./\\.}\([0-9][0-9]*\)$/\1/p" | sort -n | tail -1)
  echo "${prefix}$(( ${last:-0} + 1 ))"
else
  minor="${base%.*}"
  last=$(printf '%s\n' "$tags" | sed -n "s/^desktop-v${minor//./\\.}\.\([0-9][0-9]*\)$/\1/p" | sort -n | tail -1)
  if [ -z "$last" ]; then echo "$base"; else echo "$minor.$(( last + 1 ))"; fi
fi
