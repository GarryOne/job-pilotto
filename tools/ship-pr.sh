# Source it from tools/ship.sh: land the branch through a pull request with auto-merge instead of pushing to main (owner, 12 Oct 2026).
# Guarded by tests/test_ship_pr.py (a fake gh: tests/fake_gh.py). The checks that must pass run in CI on the PR (.github/workflows/pr-gate.yml, build.yml, recorded-pages.yml);
# the local push hook runs only its fast pure checks (SHIP_PR=1 in tools/pre-push-check.sh).
#   ship_mode                 prints pr (origin is on GitHub, gh answers and the repository allows auto-merge) or direct (any other origin: the old push to main); SHIP_MODE=pr|direct forces one
#   ship_pr_land              push the branch, open (or reuse) the PR, turn on auto-merge, wait until it is merged; sets `sha` and `files`
# A required check that failed: `fail_reason` names it with its log link and the run exits 1, the PR stays open (fix, commit, run ship again: it finds the PR).
# The check "flow-fresh" failing, or a conflict with main, is no failure: the branch is rebased on the new main (extension version taken again) and pushed again, up to 5 times.
#   SHIP_PR_POLL=<s> seconds between looks (default 15)      SHIP_PR_TIMEOUT=<s> give up waiting after (default 2700; the PR stays open with auto-merge on)
ship_mode() {
  case "${SHIP_MODE:-auto}" in pr|direct) echo "$SHIP_MODE"; return ;; esac
  # The switch-over IS the repository setting: while auto-merge is off (tools/pr-settings.sh --apply turns it on) every landing still pushes to main. No answer from gh = direct.
  case "$(git remote get-url origin 2>/dev/null)" in *github.com*) command -v gh >/dev/null && [ "$(gh api "repos/$(git remote get-url origin | sed -E 's#^.*github.com[:/]##; s#\.git$##')" --jq .allow_auto_merge 2>/dev/null)" = true ] && { echo pr; return; } ;; esac
  echo direct
}
ship_pr_fail() { fail_reason="$1"; echo "ship: FAILED $1" >&2; exit 1; }
ship_pr_push() { git push -q --force-with-lease origin "HEAD:refs/heads/$branch" 2>&1 || ship_pr_fail "could not push the branch $branch to origin"; }
ship_pr_land() {
  local n="" out view state mergeable checks failing name link tries=0 waited=0 last_say=0 body title poll="${SHIP_PR_POLL:-15}" limit="${SHIP_PR_TIMEOUT:-2700}"
  files="$(git diff --name-only origin/main HEAD)"
  step "pushing $branch (not main) and opening a pull request"
  ship_pr_push
  n="$(gh pr list --head "$branch" --state open --json number 2>/dev/null | jq -r '.[0].number // empty')" || n=""
  if [ -z "$n" ]; then
    title="$(git log --reverse --format=%s origin/main..HEAD | head -n 1)"
    body="$(git log --reverse --format='### %s%n%n%b' origin/main..HEAD; printf '\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n')"
    out="$(gh pr create --base main --head "$branch" --title "$title" --body "$body" 2>&1)" || ship_pr_fail "could not open the pull request: $(echo "$out" | tail -n 1)"
    n="${out##*/}"; step "opened the pull request: $(echo "$out" | tail -n 1)"
  else
    step "the branch already has pull request #$n: reusing it"
  fi
  if ! out="$(gh pr merge "$n" --auto --rebase 2>&1)"; then
    case "$out" in
      *"clean status"*) out="$(gh pr merge "$n" --rebase 2>&1)" || ship_pr_fail "could not merge pull request #$n: $(echo "$out" | tail -n 1)" ;;   # no check to wait for: merge now
      *) ship_pr_fail "could not turn on auto-merge for pull request #$n: $(echo "$out" | tail -n 1) (a repository setting? tools/pr-settings.sh)" ;;
    esac
  fi
  step "auto-merge is on for #$n: waiting for the required checks and the merge"
  while :; do
    view="$(gh pr view "$n" --json state,mergeable,mergeCommit,url 2>/dev/null)" || view=""
    state="$(jq -r '.state // empty' <<<"$view" 2>/dev/null)"; mergeable="$(jq -r '.mergeable // empty' <<<"$view" 2>/dev/null)"
    case "$state" in
      MERGED) sha="$(jq -r '.mergeCommit.oid // empty' <<<"$view" | cut -c1-7)"; git fetch -q origin; [ -n "$sha" ] || sha="$(git rev-parse --short origin/main)"
              step "pull request #$n is merged: $sha"; return 0 ;;
      CLOSED) ship_pr_fail "pull request #$n was closed without merging: $(jq -r '.url' <<<"$view")" ;;
    esac
    checks="$(gh pr checks "$n" --required --json name,bucket,link 2>/dev/null || true)"
    failing="$(jq -r '[.[]? | select(.bucket == "fail" or .bucket == "cancel")] | first // empty | "\(.name)\t\(.link)"' <<<"${checks:-[]}" 2>/dev/null)" || failing=""
    if [ -n "$failing" ] || [ "$mergeable" = CONFLICTING ]; then
      name="${failing%%$'\t'*}"; link="${failing#*$'\t'}"
      if [ "$name" = flow-fresh ] || { [ -z "$failing" ] && [ "$mergeable" = CONFLICTING ]; }; then
        tries=$((tries + 1)); [ "$tries" -le 5 ] || ship_pr_fail "pull request #$n still clashes with main after 5 rebases: $(jq -r '.url' <<<"$view")"
        step "main moved under files this PR changes (${name:-conflict}): rebasing again ($tries/5) and pushing it again"
        rebase; ship_pr_push; files="$(git diff --name-only origin/main HEAD)"
      else
        ship_pr_fail "required check '$name' failed: $link . Pull request #$n stays open: fix it, commit, run tools/ship.sh again"
      fi
    fi
    if [ "$waited" -ge "$limit" ]; then ship_pr_fail "pull request #$n is not merged after ${limit}s (it merges by itself when the checks pass): $(jq -r '.url' <<<"$view")"; fi
    [ $((waited - last_say)) -lt 60 ] || { step "still waiting for #$n (${waited}s)"; last_say=$waited; }
    sleep "$poll"; waited=$((waited + poll + 1))
  done
}
