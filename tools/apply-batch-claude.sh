#!/usr/bin/env bash
# apply-batch-claude.sh — open one new Terminal window per job, each running its own
# interactive Claude Code session in the sre-watch repo, pre-seeded with an apply-to-job prompt.
#
# Unlike send-to-chatgpt.sh (which has to paste into a single shared desktop-app window because
# there's no CLI/API access to it), Claude Code has a real CLI — so this spawns genuinely separate
# `claude` processes, one per job, each in its own window, running in parallel. Each session still
# stops before Submit and needs the owner to review + approve tool calls as usual; this only saves
# the "open a session, cd, type the prompt" busywork of doing that by hand for several jobs.
#
# Usage (same shape as apply-batch-chatgpt.sh and apply-batch-codex-terminal.sh):
#   tools/apply-batch-claude.sh <job_url> [job_url ...]
#   tools/apply-batch-claude.sh -f jobs.txt          # one job URL per line
#   tools/apply-batch-claude.sh --max 3   (or -n 3)  # auto-pick the N highest-scored jobs that
#                                                     # are Saved+kitted but not yet started —
#                                                     # via `python -m src.ai.apply_batch --next N`
# No --dry-run here (a spawned Claude Code session has no such mode) — use it on
# apply-batch-chatgpt.sh or apply-batch-codex-terminal.sh instead to preview a job list.
#
# Requires: the `jobpilot` alias's target repo checked out at ~/sre-watch, Terminal.app, and
#           Accessibility permission for whichever app runs this script (System Settings ->
#           Privacy & Security -> Accessibility) so System Events can open Terminal windows.
#
# Each session runs with `--permission-mode bypassPermissions` — no tool-approval prompts at all,
# not just for Read/browser calls, so it can actually run unattended in a spawned window instead
# of stalling on the first CV read or click. That's a real widening of blast radius (any tool call
# in that session executes without review), acceptable here only because: the task is narrow
# (fill one form from an already-drafted kit), the skill's own hard rule keeps it from ever
# clicking Submit regardless of tool permissions, and you're still watching the window it opens.
# Don't reuse this pattern for a less scoped prompt.

set -euo pipefail

REPO_DIR="$HOME/sre-watch"
TERMINAL_APP="Terminal"   # switch to "iTerm" if that's what's installed/preferred
GAP=3                     # seconds between spawning windows, so they don't all hit Chrome/Notion at once simultaneously

# Same Keychain fallback as apply-batch-chatgpt.sh: --next and --mark-applying below both need
# NOTION_TOKEN, and this script is usually launched fresh (not already carrying it in the shell).
if [ -z "${NOTION_TOKEN:-}" ]; then
  export NOTION_TOKEN="$(security find-generic-password -a "$USER" -s job-pilotto.notion.token -w 2>/dev/null || true)"
fi

urls=()
case "${1:-}" in
  -f)
    while IFS= read -r line; do
      [ -n "$line" ] && urls+=("$line")
    done < "$2"
    ;;
  --max|-n)
    n="$2"
    while IFS= read -r line; do
      [ -n "$line" ] && urls+=("$line")
    done < <(cd "$REPO_DIR" && python3 -m src.ai.apply_batch --next "$n")
    ;;
  *)
    for a in "$@"; do urls+=("$a"); done
    ;;
esac

if [ "${#urls[@]}" -eq 0 ]; then
  echo "Usage: $0 <job_url> [job_url ...]   or   $0 -f jobs.txt   or   $0 --max N" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
# Clean up the prompt files a bit later, well after every spawned Terminal has had time to read
# its own file — not immediately, since `do script` returns before the new shell actually runs.
( sleep 60 && rm -rf "$TMP_DIR" ) >/dev/null 2>&1 &
disown

i=0
for url in "${urls[@]}"; do
  i=$((i + 1))
  prompt_file="$TMP_DIR/prompt_$i.txt"
  cat > "$prompt_file" <<PROMPT
Use the apply-to-job skill to apply to this job: $url. Don't ask me questions or discuss the skill file — just follow it: pull the drafted kit from Notion Applications for this job URL, open the form in Chrome (claude-in-chrome), fill it per the skill's rules (fast-path dropdowns via JS, leave genuine guesses/legal checkboxes empty), verify, and hand it over for me to review and Submit. Start now.
PROMPT

  # Flip Stage to Applying right away, same dedup the ChatGPT/Codex path already does for its own
  # queued chats — so a second run (or --max picking by score again) never queues this job twice.
  (cd "$REPO_DIR" && python3 -m src.ai.apply_batch --mark-applying "$url") || \
    echo "Warning: could not mark $url as Applying (queuing it anyway)" >&2

  osascript <<OSA
tell application "$TERMINAL_APP"
  activate
  do script "cd '$REPO_DIR' && claude --permission-mode bypassPermissions \"\$(cat '$prompt_file')\""
end tell
OSA

  echo "Queued session $i/${#urls[@]}: $url"
  sleep "$GAP"
done

echo
echo "Queued ${#urls[@]} Claude Code session(s), one per Terminal window, running in parallel."
echo "Each stops before Submit — review and approve tool calls per window as usual, then Submit yourself."
