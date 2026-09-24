#!/usr/bin/env bash
# apply-batch.sh — queue every ready application kit into the ChatGPT/Codex desktop app.
# Thin wrapper around `python -m src.ai.apply_batch`; see that module's docstring for the flow.
#
# Usage:
#   tools/apply-batch.sh                 # queue up to 5 chats, pasted AND sent
#   tools/apply-batch.sh --max 3         # fewer chats
#   tools/apply-batch.sh --paste-only    # paste but don't send, review first
#   tools/apply-batch.sh --dry-run       # print the prompts, touch nothing
#
# Requires NOTION_TOKEN (Keychain entry job-pilotto.notion.token, or export it) and iTerm's
# Accessibility permission (System Settings -> Privacy & Security -> Accessibility) for
# tools/send-to-chatgpt.sh, which this calls once per ready job.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${NOTION_TOKEN:-}" ]; then
  export NOTION_TOKEN="$(security find-generic-password -a "$USER" -s job-pilotto.notion.token -w 2>/dev/null || true)"
fi
python3 -m src.ai.apply_batch "$@"
