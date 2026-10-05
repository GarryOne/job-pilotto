#!/usr/bin/env bash
# Claude Code PreToolUse hook (.claude/settings.json): before any `git push` from this repo (or one of its
# worktrees), run every test suite CI runs on a clean checkout of what is pushed, and block the push if one fails, so only green builds reach
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

# Don't stack commits on a red main: when the latest finished `build` run on main failed, block the push unless the command says it
# is the fix or a revert: `CI_RED_OK=1 git push ...`. No gh or no network: skip. A newer main commit still building (a fix in flight)
# lets a push that contains it through: its own suites still run below, on a clean checkout that includes that fix.
# The first session to meet a red main unblocks everyone (AGENTS.md "Red main"): fix it forward if it is small, else revert it.
case "$command" in *CI_RED_OK=1*) ;; *)
  if command -v gh >/dev/null; then
    last="$(cd "$repo" && gh run list --workflow build.yml --branch main --status completed -L 1 \
      --json conclusion,headSha,url --jq '.[0] | "\(.conclusion) \(.headSha[0:7]) \(.url)"' 2>/dev/null)"
    case "$last" in failure*|cancelled*|timed_out*)
      bad="$(cut -d' ' -f2 <<<"$last")"
      building="$(cd "$repo" && gh run list --workflow build.yml --branch main -L 1 \
        --json status,headSha --jq '.[0] | select(.status != "completed") | .headSha' 2>/dev/null)"
      if [ -n "$building" ] && [ "${building:0:7}" != "$bad" ] && git -C "$repo" merge-base --is-ancestor "$building" HEAD 2>/dev/null; then
        echo "pre-push: main is red at $bad, but ${building:0:7} (on top of it, in this push) is building: checking this push on its own." >&2
      else
        {
          echo "Push blocked: CI 'build' on main is red ($last)."
          echo "Unblock it now, you are not waiting for its author (AGENTS.md \"Red main\"):"
          echo "  1. See why: gh run view --log-failed $(sed 's|.*/runs/||' <<<"$last")"
          echo "  2. A small, obvious fix (missing file, import, test expectation): fix it forward, push it with CI_RED_OK=1 git push ..."
          echo "  3. Otherwise: git revert --no-edit $bad (a new commit, never a force-push), push it with CI_RED_OK=1, and tell the user what was reverted."
          echo "  Then push your own work normally. Never just add commits on top of a red build."
        } >&2
        exit 2
      fi ;;
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

# Every fix leaves a permanent check (3 Oct 2026: the method with the best record is the scripted check, and a bug fixed without one can come back
# unnoticed). A commit whose message says "Fixes #N" (or Closes/Resolves) must also change a test: tests/, desktop/test/, desktop/e2e/test/ or an e2e
# suite step. A fix that truly cannot have one says why in a "No-test: <reason>" line of its message.
untested=""
for sha in $(git -C "$repo" log origin/main..HEAD --no-merges --format='%H' 2>/dev/null); do
  message="$(git -C "$repo" log -1 --format='%B' "$sha")"
  echo "$message" | grep -qiE '\b(fix(es|ed)?|close[sd]?|resolve[sd]?)\b:?[[:space:]]+#[0-9]+' || continue
  echo "$message" | grep -qiE '^No-test:[[:space:]]*[^[:space:]]' && continue
  git -C "$repo" show --name-only --format='' "$sha" | grep -qE '^(tests/|desktop/test/|desktop/e2e/test/|desktop/e2e/suites/)' && continue
  untested="$untested$(git -C "$repo" log -1 --format='%h %s' "$sha")"$'\n'
done
if [ -n "$untested" ]; then
  echo "Push blocked: a commit fixes an issue but changes no test (every fix leaves a permanent check):" >&2
  printf '%s' "$untested" | cut -c1-110 >&2
  echo "Add the test that would have caught it, or a line 'No-test: <why>' in the commit message." >&2
  exit 2
fi

# Words a push removes from the window that an end-to-end suite still expects (5 Oct 2026: #299 and #300 were suites reporting outdated copy as bugs): update the step in the same change.
# `STALE_EXPECT_OK=1 git push ...` skips it. No node, or no origin/main to compare: skipped.
case "$command" in *STALE_EXPECT_OK=1*) ;; *)
  if command -v node >/dev/null && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
    stale="$(cd "$repo" && node tools/stale-expectations.mjs --base origin/main 2>&1)" || { echo "Push blocked: $stale" >&2; exit 2; }
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
# The suites run on exactly what is pushed, each area in its own fresh checkout of HEAD, as CI does: a forgotten file or a git-ignored
# file left by another area's run (5 Oct 2026: desktop/shared/ from a desktop run let the worker's tests pass here, fa1f838 went red in CI and
# blocked every session) fails here, not on main. Dependencies are linked from this checkout (same lockfiles; --clean-install verifies them).
verify_area() {  # area [extra check.sh flags]
  local area="$1"; shift
  local tree; tree="$(mktemp -d)/$area"
  git -C "$repo" worktree add -q --detach "$tree" HEAD || return 1
  for dir in desktop desktop/e2e worker site; do
    [ -e "$repo/$dir/node_modules" ] && ln -s "$repo/$dir/node_modules" "$tree/$dir/node_modules"
  done
  [ -e "$repo/.venv" ] && ln -s "$repo/.venv" "$tree/.venv"
  (cd "$tree" && bash tools/check.sh --area "$area" "$@"); local status=$?
  git -C "$repo" worktree remove --force "$tree" >/dev/null 2>&1 || rm -rf "$tree"
  return $status
}
run "python (clean checkout)" verify_area python --clean-install
run "worker (clean checkout)" verify_area worker
run "site (clean checkout)" verify_area site
run "desktop (clean checkout)" verify_area desktop
git -C "$repo" worktree prune 2>/dev/null

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
