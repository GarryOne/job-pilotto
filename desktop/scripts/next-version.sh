#!/usr/bin/env bash
# The version for the next desktop release, from desktop/package.json and the existing desktop-v* tags.
#   "0.5.0" -> 0.5.0, then 0.5.1, 0.5.2 … (the patch counts up, one per build)
# Start a new minor or major version by editing package.json's version (e.g. 0.6.0, 1.0.0). There is no alpha/beta suffix since 0.5:
# the channel (build, beta, stable) says how proven a build is.
set -euo pipefail
cd "$(dirname "$0")/.."
base=$(node -p "require('./package.json').version")
tags=$(git tag -l 'desktop-v*')
minor="${base%.*}"
last=$(printf '%s\n' "$tags" | sed -n "s/^desktop-v${minor//./\\.}\.\([0-9][0-9]*\)$/\1/p" | sort -n | tail -1)
if [ -z "$last" ]; then echo "$base"; else echo "$minor.$(( last + 1 ))"; fi
