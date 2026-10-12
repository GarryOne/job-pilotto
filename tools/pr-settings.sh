#!/usr/bin/env bash
# The repository settings that landing through pull requests needs (owner, 12 Oct 2026): auto-merge on, branches deleted on merge, one ruleset on main that requires the PR checks and
# forbids direct pushes. It prints the gh api calls and changes nothing unless run with --apply (outward-facing: the owner says yes first).
#   tools/pr-settings.sh            show the calls         tools/pr-settings.sh --apply   make them
# No "require up to date": parallel PRs merge at once; CI on main (build.yml, recorded-pages.yml) still catches a rare clash and the red-main rule applies as before.
# The repository admin role bypasses the ruleset only through a pull request (bypass_mode "pull_request", 12 Oct 2026, once every worktree had the PR ship): nobody pushes to main.
# "hole 3" is required since 12 Oct 2026 (owner): it caught 4 cases that passed on the old code; a follow-up names its fix with "Fix-commit: <sha>".
# The required checks are the job names of pr-gate.yml, build.yml and recorded-pages.yml.
set -euo pipefail
repo="${PR_REPO:-GarryOne/job-pilotto}"
checks='python worker site desktop\ (ubuntu-24.04) desktop\ (windows-latest) replay\ shard\ 1 replay\ shard\ 2 replay\ shard\ 3 replay\ shard\ 4 pr\ gates flow-fresh harness\ tests\ 1 harness\ tests\ 2 hole\ 3'
ruleset="$(python3 - "$checks" <<'PY'
import json, shlex, sys
names = shlex.split(sys.argv[1])
print(json.dumps({
  "name": "main: pull requests with required checks", "target": "branch", "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request"}],
  "rules": [
    {"type": "pull_request", "parameters": {"required_approving_review_count": 0, "dismiss_stale_reviews_on_push": False, "require_code_owner_review": False,
                                              "require_last_push_approval": False, "required_review_thread_resolution": False, "allowed_merge_methods": ["rebase"]}},
    {"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": False, "required_status_checks": [{"context": n} for n in names]}},
    {"type": "non_fast_forward"}, {"type": "deletion"}]}, indent=2))
PY
)"
echo "1) auto-merge on, delete branch on merge, rebase merge only:"
echo "   gh api -X PATCH repos/$repo -F allow_auto_merge=true -F delete_branch_on_merge=true -F allow_rebase_merge=true -F allow_squash_merge=false -F allow_merge_commit=false"
echo "2) the ruleset on main:"
echo "   gh api -X POST repos/$repo/rulesets --input - <<<'<json below>'"
echo "$ruleset"
[ "${1:-}" = --apply ] || { echo "(nothing changed: run with --apply after the owner's OK)"; exit 0; }
gh api -X PATCH "repos/$repo" -F allow_auto_merge=true -F delete_branch_on_merge=true -F allow_rebase_merge=true -F allow_squash_merge=false -F allow_merge_commit=false >/dev/null
existing="$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main: pull requests with required checks") | .id')"
if [ -n "$existing" ]; then gh api -X PUT "repos/$repo/rulesets/$existing" --input - <<<"$ruleset" >/dev/null; else gh api -X POST "repos/$repo/rulesets" --input - <<<"$ruleset" >/dev/null; fi
echo "applied."
