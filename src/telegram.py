"""Sending Telegram messages; the bot token comes from the environment or the macOS Keychain."""
import html
import json
import os
import re
import subprocess
import sys
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


TELEGRAM_TAG = re.compile(r'</?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler|span)(?:\s[^>]*)?>', re.I)
LINK = re.compile(r'<a\s[^>]*href="([^"]*)"[^>]*>(.*?)</a>', re.I | re.S)


def plain(text):
    """A Telegram HTML message as readable text (the terminal, logs): Telegram's tags removed, a link as
    "text (url)", entities such as &#x27; turned back into characters. Same rules as the app's readable()."""
    text = LINK.sub(lambda m: f'{m[2]} ({m[1]})' if m[2] and m[2] != m[1] else m[1], str(text or ''))
    return html.unescape(TELEGRAM_TAG.sub('', text))


# Every message this run produced (sent or shown in the app), for its ⏱️ Search runs page (cron_runs.log_run).
MESSAGES = []


def to_app(text, reply_markup=None):
    MESSAGES.append(text)
    print(f'{APP_MESSAGE[0]}\n{plain(text)}\n{APP_MESSAGE[1]}')


def api_base():
    """Telegram's Bot API, or the end-to-end tests' fake (desktop/e2e/lib/telegram-fake.mjs): only in a test run."""
    override = os.environ.get('JOB_PILOTTO_E2E_TELEGRAM_BASE_URL', '')
    return override.rstrip('/') if os.environ.get('JOB_PILOTTO_E2E') and override else 'https://api.telegram.org'


def send(text, token, chat_id, reply_markup=None):
    MESSAGES.append(text)
    endpoint = f"{api_base()}/bot{token}/sendMessage"
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


def failure_words(error):
    """What to tell the person when Telegram did not take the digest: one plain sentence, never Telegram's own JSON or the error class."""
    code = getattr(error, 'code', None)
    if code in (401, 404):
        return 'Telegram refused the digest: the bot token is not valid. Connect Telegram again in Settings.'
    if code == 403:
        return 'Telegram refused the digest: the bot was blocked or removed from the chat. Start the bot again in Telegram, or connect it again in Settings.'
    if code == 429:
        return 'Telegram is limiting the bot for a moment, so the digest was not sent. It is listed again next time.'
    if code:
        return f'Telegram did not accept the digest (error {code}). It is listed again next time.'
    return 'Telegram could not be reached, so the digest was not sent. It is listed again next time.'


def keychain_token():
    """Read the optional local macOS Keychain token without printing it."""
    # sys.platform, not os.uname(): Windows has no os.uname, so `focus remind --send` crashed on every Windows run (found in the Windows e2e log, 3 Oct 2026)
    if sys.platform != 'darwin' or os.getenv('JOB_PILOTTO_E2E'):  # the end-to-end journey never reaches the owner's real bot
        return None
    try:
        result = subprocess.run(
            ['security', 'find-generic-password', '-a', os.getenv('USER', ''),
             '-s', 'job-pilotto.telegram.bot-token', '-w'],
            check=True, capture_output=True, text=True)
        return result.stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None
