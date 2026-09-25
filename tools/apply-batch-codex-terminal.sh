#!/usr/bin/env bash
# Open one Codex CLI session per application in Terminal, using Playwright MCP's
# Chrome extension to work in the owner's existing browser profile.
#
# The ChatGPT browser extension is available to desktop-app chats, not Codex CLI.
# Install the separate Playwright Extension in Chrome before using this launcher:
# https://playwright.dev/mcp/configuration/browser-extension
# Approve each extension connection and choose the intended job tab when prompted.
#
# Usage:
#   tools/apply-batch-codex-terminal.sh [--max 5] [--dry-run]
#   tools/apply-batch-codex-terminal.sh https://example.com/job/123 [more URLs]
#   tools/apply-batch-codex-terminal.sh -f jobs.txt

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CODEX_BIN="$(command -v codex || true)"
NPX_BIN="$(command -v npx || true)"
PLAYWRIGHT_MCP_VERSION=0.0.82
GAP=3
DRY_RUN=false
source_chosen=false
urls=()

usage() {
  echo "Usage: $0 [--max N | -f jobs.txt | job_url ...] [--dry-run]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --max)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      [[ "$2" =~ ^[1-9][0-9]*$ ]] || { echo "--max needs a positive integer" >&2; exit 2; }
      max_jobs="$2"
      shift 2
      ;;
    -f)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      source_chosen=true
      while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] && urls+=("$line")
      done < "$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      usage
      exit 2
      ;;
    *)
      source_chosen=true
      urls+=("$1")
      shift
      ;;
  esac
done

if [ -n "${max_jobs:-}" ] && [ "$source_chosen" = true ]; then
  echo "Use --max or explicit URLs, not both" >&2
  exit 2
fi

if [ "$source_chosen" = false ]; then
  if [ -z "${NOTION_TOKEN:-}" ]; then
    export NOTION_TOKEN="$(security find-generic-password -a "$USER" -s job-pilotto.notion.token -w 2>/dev/null || true)"
  fi
  [ -n "${NOTION_TOKEN:-}" ] || { echo "NOTION_TOKEN is required to select jobs" >&2; exit 1; }
  next_urls="$(cd "$REPO_DIR" && python3 -m src.ai.apply_batch --next "${max_jobs:-5}")"
  while IFS= read -r line; do
    [ -n "$line" ] && urls+=("$line")
  done <<< "$next_urls"
fi

if [ "${#urls[@]}" -eq 0 ]; then
  echo "No Saved jobs with a drafted kit are ready."
  exit 0
fi

for url in "${urls[@]}"; do
  [[ "$url" == https://* ]] || { echo "Expected an HTTPS job URL: $url" >&2; exit 2; }
done

if [ "$DRY_RUN" = false ]; then
  [ -n "$CODEX_BIN" ] || { echo "codex CLI is not installed" >&2; exit 1; }
  [ -n "$NPX_BIN" ] || { echo "npx is not installed" >&2; exit 1; }
  [ -n "${NOTION_TOKEN:-}" ] || export NOTION_TOKEN="$(security find-generic-password -a "$USER" -s job-pilotto.notion.token -w 2>/dev/null || true)"
  [ -n "${NOTION_TOKEN:-}" ] || { echo "NOTION_TOKEN is required to mark queued jobs Applying" >&2; exit 1; }
fi

for url in "${urls[@]}"; do
  prompt="Read AGENTS.md and .claude/skills/apply-to-job/SKILL.md. Fill the application at $url using its drafted kit from Notion Applications, the saved Profile/Application Answers, and the CV. Follow the skill's facts and submission rules. Its claude-in-chrome tool directions are for Claude; use the Playwright MCP browser tools connected through the Playwright Chrome extension instead. Check the kit's blockers before opening the form. Verify the form and leave it open for my review. Never click Submit, never accept legal terms for me, and leave unknown personal facts empty. Report any blockers and fields I must review."
  if [ "$DRY_RUN" = true ]; then
    printf 'Would open Codex for %s\n%s\n\n' "$url" "$prompt"
    continue
  fi

  # Pass values as osascript arguments, then shell-quote them in AppleScript.
  # This keeps job URLs out of executable AppleScript and shell syntax.
  osascript - "$REPO_DIR" "$CODEX_BIN" "$NPX_BIN" "$PLAYWRIGHT_MCP_VERSION" "$prompt" <<'APPLESCRIPT'
on run argv
  set repoDir to item 1 of argv
  set codexBin to item 2 of argv
  set npxBin to item 3 of argv
  set mcpVersion to item 4 of argv
  set initialPrompt to item 5 of argv
  set mcpCommand to "mcp_servers.playwright.command=" & quoted form of npxBin
  set mcpArgs to "mcp_servers.playwright.args=[" & quoted form of "-y" & "," & quoted form of ("@playwright/mcp@" & mcpVersion) & "," & quoted form of "--extension" & "]"
  set shellCommand to "cd " & quoted form of repoDir & " && " & quoted form of codexBin & " -C " & quoted form of repoDir & " -c " & quoted form of mcpCommand & " -c " & quoted form of mcpArgs & " " & quoted form of initialPrompt
  tell application "Terminal"
    activate
    do script shellCommand
  end tell
end run
APPLESCRIPT

  (cd "$REPO_DIR" && python3 -m src.ai.apply_batch --mark-applying "$url") || \
    echo "Warning: could not mark $url Applying; check Notion before another batch" >&2
  echo "Queued Codex session: $url"
  sleep "$GAP"
done

echo "Review each Terminal session and browser tab, then click Submit yourself."
