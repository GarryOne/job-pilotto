#!/usr/bin/env bash
# Claude Code PreToolUse hook (.claude/settings.json): before any `git push` from this repo (or one of its
# worktrees), run every test suite CI runs, and block the push if one fails, so only green builds reach
# GitHub. Reads the hook's JSON on stdin; exit 2 blocks the command and shows the reason to Claude.
#   python: unittest, normally and as CI sees it (no Notion/Telegram/Google/SerpApi credentials)
#   worker, site: npm test  desktop: npm test (npm ci first when node_modules is missing)
# Also blocks a push on top of a red CI build on main, and a build.yml that installs without dev dependencies.
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

# Don't stack commits on a red main: when the latest finished `build` run on main failed, block the push
# (it says why) unless the command says it is the fix: `CI_RED_OK=1 git push ...`. No gh or no network: skip.
case "$command" in *CI_RED_OK=1*) ;; *)
  if command -v gh >/dev/null; then
    last="$(cd "$repo" && gh run list --workflow build.yml --branch main --status completed -L 1 \
      --json conclusion,headSha,url --jq '.[0] | "\(.conclusion) \(.headSha[0:7]) \(.url)"' 2>/dev/null)"
    case "$last" in failure*|cancelled*|timed_out*)
      echo "Push blocked: CI 'build' on main is red ($last). See why (gh run view --log-failed), fix it," \
        "and push the fix with CI_RED_OK=1 git push ...; don't add more commits on top of a red build." >&2
      exit 2 ;;
    esac
  fi ;;
esac

# Commit subjects: one line, at most 72 characters (AGENTS.md → Commit messages). Checks the commits this push adds on top of
# origin/main, merges aside; `COMMIT_LONG_OK=1 git push ...` skips it (a pushed commit is never rewritten to satisfy this).
case "$command" in *COMMIT_LONG_OK=1*) ;; *)
  long="$(git -C "$repo" log origin/main..HEAD --no-merges --format='%h %s' 2>/dev/null | awk '{ s=$0; sub(/^[^ ]+ /, "", s); if (length(s) > 72) print $0 }')"
  if [ -n "$long" ]; then
    echo "Push blocked: commit subject over 72 characters (details go in the body, no versions or reasons in the subject):" >&2
    echo "$long" | cut -c1-110 >&2
    echo "Shorten your own unpushed commits: git commit --amend (last one) or git rebase -i origin/main." >&2
    exit 2
  fi ;;
esac

failed=()
log="$(mktemp)"
run() {  # name, then the command
  local name="$1"; shift
  if ! (cd "$repo" && "$@") >>"$log" 2>&1; then failed+=("$name"); fi
}
# CI-only failure classes the tests can't see:
# - workflow files: actionlint (also shellchecks each run: script; info-level notes are allowed)
workflows() { SHELLCHECK_OPTS='--severity=warning' actionlint .github/workflows/*.yml; }
# - install drift: the pre-push tests run with dev dependencies installed, so CI must install them too, or a
#   test needing one (e.g. esbuild in desktop's pretest) passes here and fails on every CI run.
ci_installs_dev() {
  if grep -nE 'npm (ci|install)[^#]*--(omit|only)[= ](dev|prod)|--production' .github/workflows/build.yml; then
    echo "build.yml: the test jobs must install dev dependencies like a developer does (drop --omit/--production)"
    return 1
  fi
}
run "CI installs dev dependencies (build.yml)" ci_installs_dev
if command -v actionlint >/dev/null; then run "workflow files (actionlint)" workflows
else echo "pre-push: actionlint not installed (brew install actionlint); workflow files not checked" >&2; fi
run "project verification" bash tools/check.sh --clean-install

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
