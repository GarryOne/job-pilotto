#!/usr/bin/env bash
# One-time setup: deploy the Telegram Worker, store its secrets, point the
# bot's webhook at it and register the command menu. Safe to re-run.
#
# Prerequisites: `npx wrangler@4 login` done, `gh auth login` done, and the
# Telegram token in the macOS Keychain (sre-watch.telegram.bot-token).
set -euo pipefail
cd "$(dirname "$0")"

REPO=GarryOne/sre-watch
WRANGLER="npx --yes wrangler@4"

TG_TOKEN="$(security find-generic-password -a "$USER" -s sre-watch.telegram.bot-token -w)"

keychain() { security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true; }
ask() {  # ask <keychain service> <prompt>: reuse the Keychain value or prompt once and save it
  local value; value="$(keychain "$1")"
  if [ -z "$value" ]; then
    read -rsp "$2: " value; echo >&2
    security add-generic-password -U -a "$USER" -s "$1" -w "$value"
  fi
  printf %s "$value"
}

NOTION_TOKEN="$(ask sre-watch.notion.token 'Notion integration token (ntn_...)')"
GITHUB_TOKEN="$(ask sre-watch.github.dispatch-token 'GitHub fine-grained token with Actions read/write on sre-watch')"
WEBHOOK_SECRET="$(keychain sre-watch.telegram.webhook-secret)"
if [ -z "$WEBHOOK_SECRET" ]; then
  WEBHOOK_SECRET="$(openssl rand -hex 32)"
  security add-generic-password -U -a "$USER" -s sre-watch.telegram.webhook-secret -w "$WEBHOOK_SECRET"
fi

# The owner is whoever sent /start; getUpdates stops working once the webhook is set.
OWNER_CHAT_ID="$(keychain sre-watch.telegram.chat-id)"
if [ -z "$OWNER_CHAT_ID" ]; then
  OWNER_CHAT_ID="$(curl -fsS "https://api.telegram.org/bot${TG_TOKEN}/getUpdates" | python3 -c '
import json, sys
chats = {u["message"]["chat"]["id"] for u in json.load(sys.stdin)["result"]
         if u.get("message", {}).get("chat", {}).get("type") == "private"}
print(chats.pop() if len(chats) == 1 else "")')"
  [ -n "$OWNER_CHAT_ID" ] || { echo "Send /start to the bot, then re-run." >&2; exit 1; }
  security add-generic-password -U -a "$USER" -s sre-watch.telegram.chat-id -w "$OWNER_CHAT_ID"
fi

echo "Deploying Worker..."
DEPLOY_OUTPUT="$($WRANGLER deploy 2>&1)" || { echo "$DEPLOY_OUTPUT" >&2; exit 1; }
WORKER_URL="$(grep -Eo 'https://[a-z0-9.-]+\.workers\.dev' <<<"$DEPLOY_OUTPUT" | head -1)"
[ -n "$WORKER_URL" ] || { echo "$DEPLOY_OUTPUT" >&2; echo "Could not find the workers.dev URL." >&2; exit 1; }

echo "Storing Worker secrets..."
for name in TELEGRAM_BOT_TOKEN OWNER_CHAT_ID WEBHOOK_SECRET GITHUB_TOKEN NOTION_TOKEN; do
  case $name in
    TELEGRAM_BOT_TOKEN) value=$TG_TOKEN ;; OWNER_CHAT_ID) value=$OWNER_CHAT_ID ;;
    WEBHOOK_SECRET) value=$WEBHOOK_SECRET ;; GITHUB_TOKEN) value=$GITHUB_TOKEN ;; NOTION_TOKEN) value=$NOTION_TOKEN ;;
  esac
  printf %s "$value" | $WRANGLER secret put "$name" >/dev/null
done

echo "Storing NOTION_TOKEN for GitHub Actions..."
printf %s "$NOTION_TOKEN" | gh secret set NOTION_TOKEN --repo "$REPO"

echo "Pointing the Telegram webhook at $WORKER_URL/telegram..."
curl -fsS "https://api.telegram.org/bot${TG_TOKEN}/setWebhook" \
  --data-urlencode "url=${WORKER_URL}/telegram" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]' >/dev/null

curl -fsS "https://api.telegram.org/bot${TG_TOKEN}/setMyCommands" -H 'Content-Type: application/json' -d '{"commands":[
  {"command":"run","description":"Crawl now and send the digest"},
  {"command":"today","description":"Send the current ranked list"},
  {"command":"applied","description":"Jobs I applied to, with stage"},
  {"command":"status","description":"Last workflow runs"},
  {"command":"help","description":"Show commands"}]}' >/dev/null

echo "Done. Send /help to @swiss_sre_watch_bot."
