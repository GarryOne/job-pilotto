#!/usr/bin/env bash
# Claude Code PreToolUse hook (.claude/settings.json): before any `git push` from this repo (or one of its
# worktrees), run every test suite CI runs on a clean checkout of what is pushed, and block the push if one fails, so only green builds reach
# GitHub. Reads the hook's JSON on stdin; exit 2 blocks the command and shows the reason to Claude.
#   python: unittest, normally and as CI sees it (no Notion/Telegram/Google/SerpApi credentials)
#   worker, site: npm test  desktop: npm test (npm ci first when node_modules is missing)
# Runs only the suites the push touches (AGENTS.md "Change tiers"; PUSH_FULL=1 for all). Also blocks a push on top of a red CI build on main
# (not one that was only cancelled), and a build.yml that installs without dev dependencies.
set -uo pipefail

input="$(cat)"
command="$(jq -r '.tool_input.command // ""' <<<"$input")"
# A `git commit` whose subject is over 72 characters is stopped here, before it exists: fixing it after the commit needs an amend, which
# Claude Code's auto mode may deny, and then the push below stays blocked (5 Oct 2026). `COMMIT_LONG_OK=1` skips it.
case "$command" in *"git commit"*)
  case "$command" in *COMMIT_LONG_OK=1*) ;; *)
    subject="$(python3 "$(dirname "$0")/commit-subject.py" <<<"$command" 2>/dev/null)"
    if [ "${#subject}" -gt 72 ]; then
      echo "Commit blocked: subject is ${#subject} characters, at most 72 (details go in the body): $subject" >&2
      exit 2
    fi ;;
  esac ;;
esac
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
      # A run whose jobs were only cancelled or never started (a busy runner pool, 6 Oct 2026: 15 min queued, then cancelled) has no broken
      # test in it: it is re-run, and nobody is blocked. Only a run with a job that really failed blocks.
      url="${last##* }"; run_id="${url##*/runs/}"
      real="$(cd "$repo" && gh run view "$run_id" --json jobs --jq '[.jobs[] | select(.conclusion == "failure")] | length' 2>/dev/null)"
      if [ "$real" = "0" ]; then
        echo "pre-push: main's last build ($run_id) has no failed job (cancelled or never started): re-running it, not blocking this push." >&2
        (cd "$repo" && gh run rerun "$run_id" --failed >/dev/null 2>&1) || true
      else
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
      fi
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
    echo "Shorten your own unpushed commits: git commit --amend (last one). If the amend is denied, push it as it is:" \
      "COMMIT_LONG_OK=1 git push ... (never rewrite a pushed commit for this)." >&2
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

# The place sorter, checked with real AI answers when its code changes (7 Oct 2026: two of the day's place bugs were the real model's answers, which
# unit tests fake): tools/places_check.py, ~5 Haiku calls. `PLACES_CHECK_OK=1 git push ...` skips it (say why in the commit). No AI here: skipped, said.
case "$command" in *PLACES_CHECK_OK=1*) ;; *)
  if git -C "$repo" rev-parse --verify -q origin/main >/dev/null && git -C "$repo" diff --name-only origin/main...HEAD | grep -qE '^src/(ai/place_triage|sources/feeds)\.py$'; then
    if command -v claude >/dev/null || [ -n "${ANTHROPIC_API_KEY:-}" ]; then
      engine="$([ -n "${ANTHROPIC_API_KEY:-}" ] && echo api || echo cli)"
      checked="$(cd "$repo" && JOB_PILOTTO_FOLLOW_APP=0 JOB_PILOTTO_AI_ENGINE="$engine" python3 tools/places_check.py 2>&1)" \
        || { echo "Push blocked: the place sorter answered wrongly with real AI calls, or could not ask (tools/places_check.py):" >&2; echo "$checked" | grep -v '^⏳' | tail -25 >&2; exit 2; }
    else
      echo "Note: the place code changed but no AI is available here (no claude, no ANTHROPIC_API_KEY): tools/places_check.py skipped" >&2
    fi
  fi ;;
esac

# A new e2e step must have been seen passing (6 Oct 2026: one that never had failed the 0.5.8 beta gate on its own premise): a local run of it, or an
# "E2E-passed: <run url>" / "E2E-unverified: <why>" line in a commit message (tools/new-e2e-steps.mjs). No node, or no origin/main: skipped.
if command -v node >/dev/null && [ -f "$repo/tools/new-e2e-steps.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  unseen="$(cd "$repo" && node tools/new-e2e-steps.mjs --base origin/main 2>&1)" || { echo "Push blocked: $unseen" >&2; exit 2; }
fi

# A push that changes Applying flow code (desktop/e2e/flows.mjs FLOW_FILES) passed the whole scenario matrix on that exact code, or says why
# not (tools/flows-gate.mjs; owner, 8 Oct 2026: a fix for account creation must never quietly break the application form). No node: skipped.
if command -v node >/dev/null && [ -f "$repo/tools/flows-gate.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  flows="$(cd "$repo" && node tools/flows-gate.mjs --base origin/main 2>&1)" || { echo "Push blocked: $flows" >&2; exit 2; }
fi
# A push that changes an e2e suite names the open failed-step issues of that suite (6 Oct 2026: #310 and #315 were fixed in the test by commits that never named them,
# and were diagnosed again from scratch): "Fixes #N", "Refs #N" or "E2E-issue: none <why>" (tools/e2e-issue-links.mjs). `E2E_ISSUE_OK=1` on the push skips it.
case "$command" in *E2E_ISSUE_OK=1*) ;; *)
  if command -v node >/dev/null && [ -f "$repo/tools/e2e-issue-links.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
    links="$(cd "$repo" && node tools/e2e-issue-links.mjs --base origin/main 2>&1)" || { echo "Push blocked: $links" >&2; exit 2; }
  fi ;;
esac

# Which suites this push needs (AGENTS.md "Change tiers"). `PUSH_FULL=1 git push ...` runs everything (Tier 2). Docs alone run nothing; a path
# this list does not know runs everything. The engine (src/, tests/) also runs desktop: its callers. A clean pip install only when dependencies changed.
changed="$(git -C "$repo" diff --name-only origin/main..HEAD 2>/dev/null)"
want_python=0; want_worker=0; want_site=0; want_desktop=0; want_workflows=0; clean_install=""
if [ -z "$changed" ]; then want_python=1; want_worker=1; want_site=1; want_desktop=1; want_workflows=1; clean_install=--clean-install
else
  while IFS= read -r file; do
    case "$file" in
      *.md|docs/*|LICENSE*|.gitignore|*/.gitignore) ;;
      worker/*) want_worker=1 ;;
      site/*) want_site=1 ;;
      desktop/*|extension/*) want_desktop=1 ;;
      requirements*|pyproject.toml) want_python=1; want_desktop=1; clean_install=--clean-install ;;
      src/*|tests/*) want_python=1; want_desktop=1 ;;
      .github/*) want_workflows=1 ;;
      *) want_python=1; want_worker=1; want_site=1; want_desktop=1; want_workflows=1 ;;
    esac
  done <<<"$changed"
fi
case "$command" in *PUSH_FULL=1*) want_python=1; want_worker=1; want_site=1; want_desktop=1; want_workflows=1; clean_install=--clean-install ;; esac

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
if [ "$want_workflows" = 1 ]; then
  run "CI installs dev dependencies (build.yml)" ci_installs_dev
  if command -v actionlint >/dev/null; then run "workflow files (actionlint)" workflows
  else echo "pre-push: actionlint not installed (brew install actionlint); workflow files not checked" >&2; fi
fi
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
[ "$want_python" = 1 ] && run "python (clean checkout)" verify_area python $clean_install
[ "$want_worker" = 1 ] && run "worker (clean checkout)" verify_area worker
[ "$want_site" = 1 ] && run "site (clean checkout)" verify_area site
[ "$want_desktop" = 1 ] && run "desktop (clean checkout)" verify_area desktop
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
