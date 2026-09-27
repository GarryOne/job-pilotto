#!/usr/bin/env bash
# Claude Code PreToolUse hook (.claude/settings.json): before any `git push` from this repo (or one of its
# worktrees), run every test suite CI runs, and block the push if one fails, so only green builds reach
# GitHub. Reads the hook's JSON on stdin; exit 2 blocks the command and shows the reason to Claude.
#   python: unittest, normally and as CI sees it (no Notion/Telegram/Google/SerpApi credentials)
#   worker: npm test        desktop: npm test (npm ci first when node_modules is missing)
set -uo pipefail

input="$(cat)"
command="$(jq -r '.tool_input.command // ""' <<<"$input")"
case "$command" in *"git push"*) ;; *) exit 0 ;; esac

# The directory the push runs in: the last `cd <dir>` before `git push` in the command, else the call's cwd.
dir="$(jq -r '.cwd // ""' <<<"$input")"
before_push="${command%%git push*}"
last_cd="$(grep -oE 'cd[[:space:]]+[^;&|]+' <<<"$before_push" | tail -1 | sed -E 's/^cd[[:space:]]+//; s/[[:space:]]+$//')"
if [ -n "$last_cd" ]; then
  last_cd="${last_cd/#\~/$HOME}"
  case "$last_cd" in /*) dir="$last_cd" ;; *) dir="$dir/$last_cd" ;; esac
fi
repo="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -f "$repo/src/daily.py" ] && [ -d "$repo/worker" ] || exit 0   # only this project

failed=()
log="$(mktemp)"
run() {  # name, then the command
  local name="$1"; shift
  if ! (cd "$repo" && "$@") >>"$log" 2>&1; then failed+=("$name"); fi
}
python_tests() { python3 -m unittest discover -s tests -q; }
python_ci() { JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs python3 -m unittest discover -s tests -q; }
node_tests() {  # folder
  cd "$1" && { [ -d node_modules ] || npm ci --silent; } && npm test --silent
}
# CI-only failure classes the tests can't see:
# - workflow files: actionlint (also shellchecks each run: script; info-level notes are allowed)
workflows() { SHELLCHECK_OPTS='--severity=warning' actionlint .github/workflows/*.yml; }
# - lock files: the runners use `npm ci`, which refuses a lock file out of sync with package.json. When a
#   package.json or lock file changed in the commits being pushed, prove `npm ci` works from scratch.
clean_install() {  # folder
  local scratch; scratch="$(mktemp -d)"
  cp "$1/package.json" "$1/package-lock.json" "$scratch/" && (cd "$scratch" && npm ci --ignore-scripts --silent)
  local code=$?; rm -rf "$scratch"; return $code
}
if command -v actionlint >/dev/null; then run "workflow files (actionlint)" workflows
else echo "pre-push: actionlint not installed (brew install actionlint); workflow files not checked" >&2; fi
upstream="$(git -C "$repo" rev-parse --verify -q '@{upstream}' 2>/dev/null || git -C "$repo" rev-parse -q origin/main)"
for folder in worker desktop; do
  if [ -f "$repo/$folder/package-lock.json" ] && git -C "$repo" diff --quiet "$upstream" HEAD -- "$folder/package.json" "$folder/package-lock.json"; then :; 
  elif [ -f "$repo/$folder/package-lock.json" ]; then run "$folder clean npm ci" clean_install "$folder"; fi
done
run "python" python_tests
run "python (as CI, no credentials)" python_ci
run "worker" node_tests worker
[ -f "$repo/desktop/package.json" ] && run "desktop" node_tests desktop

if [ ${#failed[@]} -gt 0 ]; then
  {
    echo "Push blocked: tests failed in ${failed[*]} ($repo)."
    echo "Fix them, then push again. Last lines of the test output:"
    grep -E "^FAIL:|^ERROR:|AssertionError|^not ok|npm ERR|npm error|\.yml:[0-9]+:[0-9]+:" "$log" | sort -u | tail -15
  } >&2
  rm -f "$log"
  exit 2
fi
rm -f "$log"
exit 0
