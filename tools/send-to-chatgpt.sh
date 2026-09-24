#!/usr/bin/env bash
# send-to-chatgpt.sh — paste (and optionally send) a prompt into the ChatGPT/Codex desktop app.
#
# Limitation: this only automates typing. There is no tool available to read back what the
# app does or says afterwards — you still have to watch the window and report the result.
#
# Usage:
#   send-to-chatgpt.sh "your prompt text"          # types into a NEW chat, pastes, does NOT send
#   send-to-chatgpt.sh -f prompt.txt                # same, reading the prompt from a file
#   send-to-chatgpt.sh --send "your prompt text"    # also presses Return to send it
#
# Requires: this terminal (or its parent app) must have Accessibility permission
#           (System Settings -> Privacy & Security -> Accessibility) so System Events
#           can send keystrokes to the ChatGPT app.

set -euo pipefail

APP_NAME="ChatGPT"   # bundle id com.openai.codex on this machine
SEND=false
PROMPT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --send) SEND=true; shift ;;
    -f) PROMPT="$(cat "$2")"; shift 2 ;;
    *) PROMPT="$1"; shift ;;
  esac
done

if [ -z "$PROMPT" ]; then
  echo "Usage: $0 [--send] \"prompt text\"   or   $0 [--send] -f prompt.txt" >&2
  exit 1
fi

printf '%s' "$PROMPT" | pbcopy

osascript <<OSA
tell application "$APP_NAME" to activate
delay 1
tell application "System Events"
  tell process "$APP_NAME"
    keystroke "n" using {command down}   -- new chat, harmless if it just focuses input instead
    delay 0.6
    keystroke "v" using {command down}   -- paste the prompt
    delay 0.4
    $( $SEND && echo 'key code 36' || echo '-- not sending: rerun with --send once you have reviewed the pasted text' )
  end tell
end tell
OSA

echo "Pasted into $APP_NAME.$( $SEND && echo ' Sent (pressed Return).' || echo ' NOT sent — review the input box, then press Return yourself, or rerun with --send.')"
