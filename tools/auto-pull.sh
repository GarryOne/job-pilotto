#!/usr/bin/env bash
# Keeps the owner's checkout (~/job-pilotto) on origin/main by itself (owner, 14 Oct 2026: a hand `git pull` found the checkout a day behind).
# A macOS launch agent runs it every 2 minutes. It only fast-forwards a clean `main`: a modified tracked file, another branch, a detached HEAD or a
# diverged history is skipped and said once in a notification (never a stash, reset or overwrite). After an update it says whether the app needs a
# restart (main process, lib, preload, engine, extension) or only ⌘R (window). Guard: tests/test_auto_pull.py.
#   tools/auto-pull.sh               one check (what the launch agent runs)
#   tools/auto-pull.sh --install     write and load the launch agent (~/Library/LaunchAgents/com.jobpilotto.autopull.plist)
#   tools/auto-pull.sh --uninstall   unload and remove it
set -u
REPO="${JP_AUTOPULL_REPO:-$HOME/job-pilotto}"
LOG="${JP_AUTOPULL_LOG:-$HOME/Library/Logs/job-pilotto-autopull.log}"
STATE="${JP_AUTOPULL_STATE:-$HOME/Library/Logs/job-pilotto-autopull.state}"
LABEL=com.jobpilotto.autopull
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

log() { mkdir -p "$(dirname "$LOG")"; echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
notify() {   # JP_AUTOPULL_NOTIFY_FILE: tests read the notices from a file instead of macOS notifications
  if [ -n "${JP_AUTOPULL_NOTIFY_FILE:-}" ]; then echo "$1" >> "$JP_AUTOPULL_NOTIFY_FILE"; return; fi
  command -v osascript >/dev/null 2>&1 && osascript -e "display notification \"$1\" with title \"Job Pilotto checkout\"" >/dev/null 2>&1 || true
}
# A skip is said once, not every 2 minutes: the last reason is kept and a notice goes out only when it changes.
skip() {
  log "skip: $1"
  [ "$(cat "$STATE" 2>/dev/null)" = "$1" ] || notify "Not updated: $1"
  mkdir -p "$(dirname "$STATE")"; echo "$1" > "$STATE"
  exit 0
}

case "${1:-}" in
  --install)
    script="$(cd "$(dirname "$0")" && pwd)/auto-pull.sh"
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$script</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "auto-pull: installed ($PLIST, every 2 min, log $LOG)"
    exit $? ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST" && echo "auto-pull: removed"
    exit 0 ;;
esac

cd "$REPO" 2>/dev/null || skip "no checkout at $REPO"
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || skip "detached HEAD (git switch main)"
[ "$branch" = main ] || skip "on branch $branch, not main"
git fetch --quiet origin main 2>>"$LOG" || skip "fetch failed (offline?)"
old="$(git rev-parse HEAD)" new="$(git rev-parse origin/main)"
[ "$old" = "$new" ] && { rm -f "$STATE"; exit 0; }
git merge-base --is-ancestor HEAD origin/main || skip "local main has commits origin/main lacks (not a fast-forward)"
dirty="$(git status --porcelain --untracked-files=no | head -3 | cut -c4- | tr '\n' ' ')"
[ -z "$dirty" ] || skip "modified tracked files: ${dirty% }"
git merge --ff-only --quiet origin/main 2>>"$LOG" || skip "fast-forward refused (see $LOG)"
rm -f "$STATE"
changed="$(git diff --name-only "$old" "$new")"
if echo "$changed" | grep -q -E '^(desktop/main\.js|desktop/lib/|desktop/preload\.cjs|desktop/shared/|src/|extension/)'; then
  what='restart the app'
elif echo "$changed" | grep -q '^desktop/renderer/'; then
  what='press ⌘R in the window'
else
  what='nothing to restart'
fi
log "updated ${old:0:7} -> ${new:0:7} ($(echo "$changed" | wc -l | tr -d ' ') files): $what"
notify "Updated to ${new:0:7}: $what"
