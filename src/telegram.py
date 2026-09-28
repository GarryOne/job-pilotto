"""Sending Telegram messages; the bot token comes from the environment or the macOS Keychain."""
import json
import os
import subprocess
import urllib.parse
import urllib.request


def credentials():
    token, chat_id = os.getenv('TELEGRAM_BOT_TOKEN') or keychain_token(), os.getenv('TELEGRAM_CHAT_ID')
    if not token or not chat_id:
        raise SystemExit('--send requires TELEGRAM_CHAT_ID and either TELEGRAM_BOT_TOKEN or the local Keychain entry')
    return token, chat_id


# Without Telegram, a message goes to whoever ran us: the desktop app reads the text between these markers
# from the output and shows it (Actions page, Recent activity). reply_markup (buttons) has no meaning there.
APP_MESSAGE = ('<<<message', 'message>>>')


def to_app(text, reply_markup=None):
    print(f'{APP_MESSAGE[0]}\n{text}\n{APP_MESSAGE[1]}')


def send(text, token, chat_id, reply_markup=None):
    endpoint = f"https://api.telegram.org/bot{token}/sendMessage"
    fields = {'chat_id': chat_id, 'text': text, 'parse_mode': 'HTML', 'disable_web_page_preview': 'true'}
    if reply_markup:
        fields['reply_markup'] = json.dumps(reply_markup)
    body = urllib.parse.urlencode(fields).encode()
    request = urllib.request.Request(endpoint, data=body, method='POST')
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
    if not payload.get('ok'):
        raise RuntimeError(payload.get('description', 'Telegram API rejected the message'))
    return payload


def keychain_token():
    """Read the optional local macOS Keychain token without printing it."""
    if os.uname().sysname != 'Darwin':
        return None
    try:
        result = subprocess.run(
            ['security', 'find-generic-password', '-a', os.getenv('USER', ''),
             '-s', 'job-pilotto.telegram.bot-token', '-w'],
            check=True, capture_output=True, text=True)
        return result.stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None
