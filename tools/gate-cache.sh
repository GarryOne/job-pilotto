#!/usr/bin/env bash
# Content cache for the push gate: a suite that passed on exactly the same inputs is not run again. `source tools/gate-cache.sh`, then
#   gate_cache_run <repo> <area> <extra-key-text> <command...>    runs the command unless this area passed before on the same inputs
# Key = sha256 of: every tracked file's path+blob at HEAD (tests read across areas, so the whole tree counts, minus the paths listed in
# tools/gate-cache-ignore.txt, which no test reads), node and python versions, the area, and the caller's extra text (which tests were picked,
# clean install or not). GATE_CACHE_DIRTY=1 (the Stop hook) adds uncommitted changes and untracked files. A pass is stored under
# <git common dir>/gate-cache/<area>-<key> (shared by every worktree, never committed); a failure is never stored.
# GATE_CACHE=0 turns it off; GATE_CACHE_FRESH=1 (PUSH_FULL=1) ignores a stored pass but still stores the new one. A hit says so on the
# file named by GATE_CACHE_NOTES. Owner: landing-speed (11 Oct 2026). Guarded by tests/test_gate_cache.py.

gate_cache_dir() { local c; c="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" && echo "$c/gate-cache"; }

gate_cache_key() {  # repo area extra
  local repo="$1" area="$2" extra="$3" ignore
  ignore="$repo/tools/gate-cache-ignore.txt"
  {
    echo "area=$area extra=$extra node=$(node -v 2>/dev/null) python=$(python3 -V 2>&1)"
    if [ -f "$ignore" ]; then
      git -C "$repo" ls-tree -r HEAD | grep -vF -f <(grep -vE '^(#|$)' "$ignore" | awk '{ printf "\t%s\n", $0 }')
    else git -C "$repo" ls-tree -r HEAD; fi
    if [ "${GATE_CACHE_DIRTY:-0}" = 1 ]; then
      git -C "$repo" diff HEAD
      git -C "$repo" ls-files --others --exclude-standard -z | (cd "$repo" && xargs -0 shasum 2>/dev/null)
    fi
  } | shasum -a 256 | cut -c1-32
}

gate_cache_run() {  # repo area extra command...
  local repo="$1" area="$2" extra="$3" dir key file code=0; shift 3
  dir="$(gate_cache_dir "$repo")" || { "$@"; return; }
  if [ "${GATE_CACHE:-1}" = 0 ] || [ -z "$dir" ]; then "$@"; return; fi
  key="$(gate_cache_key "$repo" "$area" "$extra")"; file="$dir/$area-$key"
  if [ "${GATE_CACHE_FRESH:-0}" != 1 ] && [ -f "$file" ]; then
    echo "gate-cache: cached pass from $(date -r "$file" '+%F %T') for $area (inputs $key); GATE_CACHE=0 runs it anyway" >>"${GATE_CACHE_NOTES:-/dev/null}"
    return 0
  fi
  "$@" || code=$?
  if [ "$code" = 0 ]; then
    mkdir -p "$dir" && echo "passed $(date -u +%FT%TZ)" >"$file" 2>/dev/null || true
    find "$dir" -type f -mtime +14 -delete 2>/dev/null || true
  fi
  return "$code"
}

gate_cache_has() {  # repo area extra: is there a stored pass? (the Stop hook, which runs its own command)
  local dir; dir="$(gate_cache_dir "$1")" || return 1
  [ "${GATE_CACHE:-1}" != 0 ] && [ -f "$dir/$2-$(gate_cache_key "$1" "$2" "$3")" ]
}
