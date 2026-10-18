#!/usr/bin/env bash
# Lays out the description of a PR that a workflow opens by itself (daily discovery, finder-review, sentry-fix, ui-fix) through tools/pr-body.sh, so the PR-description check passes. Guard: tests/test_bot_pr_bodies.py.
#   tools/bot-pr-body.sh <base> --verdict=<emoji + one line> --why=<..> --unblocks=<..> --label=<what> --before=<..> --after=<..> [--detail=<file>] [--no-screens=<why>] [--rate="<Area>=<🟢 High|🟡 Medium|⚪ Low|— None>|<how>"]... > body.md
# Run it AFTER the workflow's commit (the facts come from <base>..HEAD, e.g. HEAD~1). Areas not rated are "— None". The bot's own text (--detail) is kept folded in a <details>, its images turned into links (only the Before/After table holds images).
set -euo pipefail
base="${1:?usage: tools/bot-pr-body.sh <base> --verdict=.. --why=.. --unblocks=.. --label=.. --before=.. --after=.. [--detail=<file>]}"; shift
verdict=""; why=""; unblocks=""; label="What"; before=""; after=""; detail=""; noshots="Opened by a workflow; read the diff."; rates=()
for arg in "$@"; do case "$arg" in
  --verdict=*) verdict="${arg#*=}" ;; --why=*) why="${arg#*=}" ;; --unblocks=*) unblocks="${arg#*=}" ;; --label=*) label="${arg#*=}" ;;
  --before=*) before="${arg#*=}" ;; --after=*) after="${arg#*=}" ;; --detail=*) detail="${arg#*=}" ;; --no-screens=*) noshots="${arg#*=}" ;; --rate=*) rates+=("${arg#*=}") ;;
  *) echo "bot-pr-body: unknown argument $arg" >&2; exit 2 ;; esac; done
for need in verdict why unblocks before after; do [ -n "${!need}" ] || { echo "bot-pr-body: --$need is required" >&2; exit 2; }; done
rate() {   # area -> "<rating> | <how>" (from --rate, else "— None | not touched")
  local r; for r in "${rates[@]+"${rates[@]}"}"; do case "$r" in "$1="*) r="${r#*=}"; echo "${r%%|*} | ${r#*|}"; return ;; esac; done
  echo '— None | not touched'
}
summary="$(mktemp)"; trap 'rm -f "$summary"' EXIT
{
  printf '%s\n\n**Why:** %s\n**Unblocks:** %s\n\n| Area | Impact | How |\n|---|---|---|\n' "$verdict" "$why" "$unblocks"
  for pair in '👤 Real users=Real users' '📝 Form filling=Form filling' '📊 Admin data accuracy=Admin data accuracy' '🔁 Offline replays=Offline replays' '🧪 Tests & harness=Tests & harness' '⚡ Development speed=Development speed' '💰 Cost=Cost'; do
    printf '| %s | %s |\n' "${pair%%=*}" "$(rate "${pair#*=}")"
  done
  printf '\n- ✅ Opened by a workflow; the owner reviews and merges it\n\n| %s | Before | After |\n|---|---|---|\n| %s | %s | %s |\n\n' "$label" "$label" "$before" "$after"
  printf 'No screenshots: %s\n' "$noshots"
} > "$summary"
body="$(bash "$(dirname "$0")/pr-body.sh" "$base" "--body=$summary")"
if [ -n "$detail" ] && [ -s "$detail" ]; then
  printf '%s\n\n---\n\n<details><summary>🤖 What the workflow wrote</summary>\n\n' "$body"
  sed -E 's/!\[([^]]*)\]\(/[\1](/g; s/<img [^>]*>/(image)/g' "$detail"
  printf '\n</details>\n'
else printf '%s\n' "$body"; fi
