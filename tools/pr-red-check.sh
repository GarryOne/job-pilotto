#!/usr/bin/env bash
# Claude Code UserPromptSubmit + Stop hook (.claude/settings.json): a session whose open PR has a red check is told so, and cannot go idle on it.
#   UserPromptSubmit: prints "PR #n is red: <checks> <job url>; fix it now" into the context.   Stop: the same on stderr + exit 2, once per stop chain (stop_hook_active).
# Which PRs: the open PR of the branch of the session's cwd and of every worktree it ran tools/ship.sh from. Red = a check FAILURE / TIMED_OUT (a cancelled check is no red:
# a push cancels the older run). `tools/pr-red-ack.sh <n> "<why>"` says "blocked for real": silent until the set of red checks changes. No answer from gh in ~2 s, no gh, no PR: silent.
# One look per branch per 60 s (cache in the git dir). PR_RED_CHECK=0 off; PR_RED_DIR / PR_RED_TTL / PR_RED_WAIT (tenths of a second) for tests. 18 Oct 2026: #1321 sat red
# on two desktop jobs for hours and nobody reacted until the owner asked. Guard: tests/test_pr_red_hook.py.
set -uo pipefail
[ "${PR_RED_CHECK:-1}" != 0 ] || exit 0
[ -z "${JOB_PILOTTO_SESSION:-}" ] || exit 0   # an "Apply with Claude" session of the desktop app changes no code
command -v gh >/dev/null && command -v jq >/dev/null || exit 0
input="$(cat)"
jqr() { jq -r "$1" <<<"$input" 2>/dev/null; }
cwd="$(jqr '.cwd // ""')"; transcript="$(jqr '.transcript_path // ""')"; event="$(jqr '.hook_event_name // ""')"; again="$(jqr '.stop_hook_active // false')"
[ -n "$cwd" ] && [ -d "$cwd" ] || exit 0
common="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
dir="${PR_RED_DIR:-$common/pr-red}"; mkdir -p "$dir" 2>/dev/null || exit 0
ttl="${PR_RED_TTL:-60}"; wait_tenths="${PR_RED_WAIT:-20}"

dirs=("$cwd")
if [ -f "$transcript" ]; then
  while IFS= read -r w; do [ -d "$w" ] && dirs+=("$w"); done < <(
    tail -n 4000 "$transcript" | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Bash") | .input.command // empty' 2>/dev/null |
      grep -E 'tools/ship\.sh' | grep -oE '/[^[:space:]"'"'"'`;|&()]*\.claude/worktrees/[^/[:space:]"'"'"'`;|&()]+' | sort -u | head -5)
fi

lookup() {  # <branch>: prints "<n>\t<url>\t<red checks joined by ,>" for its open PR when one is red, nothing otherwise; cached for $ttl seconds
  local branch="$1" key file now stamp out
  key="${branch//\//-}"; file="$dir/$key.look"; now="$(date +%s)"
  stamp="$(head -n 1 "$file" 2>/dev/null)"
  if [ -n "$stamp" ] && [ "$((now - stamp))" -ge 0 ] 2>/dev/null && [ "$((now - stamp))" -lt "$ttl" ]; then tail -n +2 "$file"; return 0; fi
  local tmp="$file.$$"
  ( gh pr list --head "$branch" --state open --json number,statusCheckRollup --jq '
      .[0] // empty | . as $pr | [ .statusCheckRollup[]? | select(.conclusion == "FAILURE" or .conclusion == "TIMED_OUT" or .conclusion == "STARTUP_FAILURE" or .state == "FAILURE" or .state == "ERROR")
        | {name: (.name // .context), url: (.detailsUrl // .targetUrl // "")} ] | select(length > 0)
      | "\($pr.number)\t\(.[0].url)\t\([.[].name] | unique | join(","))"' > "$tmp" 2>/dev/null; echo done >> "$tmp.ok" ) &
  local pid=$! i=0
  while [ ! -e "$tmp.ok" ] && [ "$i" -lt "$wait_tenths" ]; do sleep 0.1; i=$((i + 1)); done
  if [ ! -e "$tmp.ok" ]; then kill "$pid" 2>/dev/null; rm -f "$tmp" "$tmp.ok"; return 0; fi   # too slow: skip, and look again next time
  out="$(cat "$tmp")"; rm -f "$tmp" "$tmp.ok"
  { echo "$now"; [ -z "$out" ] || echo "$out"; } > "$file"
  [ -z "$out" ] || printf '%s\n' "$out"
}

messages=""; seen=" "
for d in "${dirs[@]}"; do
  branch="$(git -C "$d" symbolic-ref --short -q HEAD 2>/dev/null)" || continue
  case "$branch" in main|HEAD|"") continue ;; esac
  case "$seen" in *" $branch "*) continue ;; esac; seen="$seen$branch "
  row="$(lookup "$branch")"; [ -n "$row" ] || continue
  IFS=$'\t' read -r n url checks <<<"$row"
  ack="$dir/ack-$n"; [ "$(cat "$ack" 2>/dev/null | head -n 1)" != "$checks" ] || continue   # acknowledged for exactly this set of red checks
  messages="${messages}PR #$n is red: ${checks//,/, } ${url}; fix it now (global rule: read the failing job's log, fix the cause, push through tools/ship.sh --background; blocked for real: tools/pr-red-ack.sh $n \"<why>\")
"
done
[ -n "$messages" ] || exit 0
case "$event" in
  Stop) [ "$again" = true ] && exit 0; printf '%s' "$messages" >&2; exit 2 ;;   # blocks once per stop chain: a second stop in the chain goes through
  *) printf '%s' "$messages"; exit 0 ;;
esac
