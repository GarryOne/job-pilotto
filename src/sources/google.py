#!/usr/bin/env python3
"""Read-only Google access for Job Pilotto: Gmail (job-related emails) and Calendar (interviews).

Scopes are gmail.readonly and calendar.readonly: nothing is ever sent, changed or deleted. `auth` runs the
one-time browser sign-in on this Mac (loopback redirect + PKCE), stores the refresh token in the Keychain,
and with --github also sets the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
repository secrets for CI.

Two ways to connect:
- The shared Job Pilotto app (default): the published "Job Pilotto" Google app. Its client file,
  config/google_oauth_client.json, is not in git: the Mac app build adds it from the
  GOOGLE_SHARED_CLIENT_JSON secret. One command, one browser consent, no Google Cloud setup.
- Your own Google app: `setup` walks you through creating one (src/sources/google_setup.py), or pass a
  client you made with --client-json.

Usage:
  python -m src.sources.google auth --github                  # shared app
  python -m src.sources.google setup                          # guided: your own Google app
  python -m src.sources.google auth --client-json ~/Downloads/client_secret_….json --github [--production]
  python -m src.sources.google check
"""
import argparse
import base64
import hashlib
import html
import http.server
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path
from email.utils import parsedate_to_datetime

SCOPES = ('https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly')
TOKEN_URL = 'https://oauth2.googleapis.com/token'
SHARED_CLIENT = Path(__file__).resolve().parents[2] / 'config' / 'google_oauth_client.json'
KEYCHAIN = {'GOOGLE_CLIENT_ID': 'job-pilotto.google.client-id', 'GOOGLE_CLIENT_SECRET': 'job-pilotto.google.client-secret',
            'GOOGLE_REFRESH_TOKEN': 'job-pilotto.google.refresh-token'}


def _keychain(service):
    if sys.platform != 'darwin':
        return None
    result = subprocess.run(['security', 'find-generic-password', '-a', os.getenv('USER', ''), '-s', service, '-w'],
                            capture_output=True, text=True)
    return result.stdout.strip() or None if result.returncode == 0 else None


def credentials():
    """(client id, client secret, refresh token) from the environment (CI) or the Keychain, or None."""
    values = [os.getenv(name) or _keychain(service) for name, service in KEYCHAIN.items()]
    return tuple(values) if all(values) else None


class Google:
    def __init__(self, client_id, client_secret, refresh_token, opener=urllib.request.urlopen):
        self.client_id, self.client_secret, self.refresh_token = client_id, client_secret, refresh_token
        self.opener, self._token = opener, None

    @classmethod
    def from_env(cls):
        from ..features import disabled
        if disabled('mail'):  # JOB_PILOTTO_DISABLE=mail
            return None
        found = credentials()
        return cls(*found) if found else None

    def _access_token(self):
        if not self._token:
            body = urllib.parse.urlencode({'client_id': self.client_id, 'client_secret': self.client_secret,
                                           'refresh_token': self.refresh_token, 'grant_type': 'refresh_token'}).encode()
            try:
                with self.opener(urllib.request.Request(TOKEN_URL, data=body), timeout=20) as response:
                    self._token = json.load(response)['access_token']
            except urllib.error.HTTPError as error:
                raise RuntimeError(f'Google token refresh failed ({error.code}): {error.read().decode(errors="replace")[:200]}') from error
        return self._token

    def get(self, url, params=None):
        if params:
            url += '?' + urllib.parse.urlencode(params, doseq=True)
        request = urllib.request.Request(url, headers={'Authorization': f'Bearer {self._access_token()}'})
        with self.opener(request, timeout=30) as response:
            return json.load(response)

    # ---------- Gmail ----------

    def search(self, query, limit=50):
        """Message ids matching a Gmail search, newest first."""
        ids, token = [], None
        while len(ids) < limit:
            params = {'q': query, 'maxResults': min(100, limit - len(ids))}
            if token:
                params['pageToken'] = token
            page = self.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', params)
            ids += [m['id'] for m in page.get('messages', [])]
            token = page.get('nextPageToken')
            if not token:
                break
        return ids

    def message(self, message_id):
        """{id, from, to, subject, date (ISO), body} of one email; the body is plain text, capped."""
        data = self.get(f'https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}', {'format': 'full'})
        headers = {h['name'].lower(): h['value'] for h in data['payload'].get('headers', [])}
        try:
            sent = parsedate_to_datetime(headers.get('date', '')).isoformat()
        except (TypeError, ValueError):
            sent = datetime.fromtimestamp(int(data.get('internalDate', 0)) / 1000, timezone.utc).isoformat()
        return {'id': data['id'], 'from': headers.get('from', ''), 'to': headers.get('to', ''),
                'subject': headers.get('subject', ''), 'date': sent, 'body': body_text(data['payload'])[:4000]}

    def profile(self):
        return self.get('https://gmail.googleapis.com/gmail/v1/users/me/profile')

    # ---------- Calendar ----------

    def events(self, start, end, calendar='primary'):
        """Single events (recurring ones expanded) between two datetimes, by start time."""
        page = self.get(f'https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(calendar)}/events', {
            'timeMin': start.isoformat(), 'timeMax': end.isoformat(), 'singleEvents': 'true',
            'orderBy': 'startTime', 'maxResults': 250})
        return page.get('items', [])


def _decode(data):
    return base64.urlsafe_b64decode(data + '=' * (-len(data) % 4)).decode('utf-8', errors='replace')


def body_text(payload):
    """The text/plain part, else the text/html part with tags removed."""
    plain_parts, html_parts = [], []

    def walk(part):
        mime, data = part.get('mimeType', ''), (part.get('body') or {}).get('data')
        if data and mime == 'text/plain':
            plain_parts.append(_decode(data))
        elif data and mime == 'text/html':
            html_parts.append(_decode(data))
        for child in part.get('parts', []) or []:
            walk(child)
    walk(payload)
    if plain_parts:
        return '\n'.join(plain_parts).strip()
    text = re.sub(r'(?is)<(script|style).*?</\1>', ' ', '\n'.join(html_parts))
    text = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</li>', '\n', text)
    return re.sub(r'[ \t\xa0]+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', text))).strip()


# ---------- sign-up confirmation (Apply with Claude) ----------

CODE = re.compile(r'(?<![\w/#-])(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}(?![\w/-])')
CONFIRM_LINK = re.compile(r'https?://[^\s<>"\')\]]+', re.I)
CONFIRM_WORDS = re.compile(r'verif|confirm|activat|validat|register|token|code|otp', re.I)


def confirmation(email):
    """The verification code and confirm links in one email: only what finishing a sign-up needs."""
    text = f"{email['subject']}\n{email['body']}"
    near = (CODE.search(m.group(0)) for m in re.finditer(r'(?i)(code|pin|otp|password)[^\n]{0,60}', text))
    code = next((c for c in near if c), None) or CODE.search(email['subject'])
    links = [link.rstrip('.,;') for link in CONFIRM_LINK.findall(email['body']) if CONFIRM_WORDS.search(link)]
    return {'from': email['from'], 'subject': email['subject'], 'date': email['date'],
            'code': code.group(0) if code else '', 'links': list(dict.fromkeys(links))[:3]}


def wait_for_confirmation(google, sender='', minutes=15, wait=180, every=10, sleep=time.sleep):
    """Newest email from the last `minutes` (from `sender`, a domain or address, if given) that has a
    code or a confirm link; polls for up to `wait` seconds while the site sends it. None if none came."""
    query = f'newer_than:1d{f" from:{sender}" if sender else ""}'
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    for attempt in range(max(1, wait // every + 1)):
        for message_id in google.search(query, limit=10):
            email = google.message(message_id)
            try:
                recent = datetime.fromisoformat(email['date']) >= since
            except ValueError:
                recent = True
            found = confirmation(email) if recent else None
            if found and (found['code'] or found['links']):
                return found
        if attempt * every < wait:
            sleep(every)
    return None


# ---------- one-time sign-in ----------

def authorize(client_id, client_secret, open_browser=webbrowser.open):
    """Browser consent on this Mac; returns the refresh token."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    state, result = secrets.token_urlsafe(16), {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            result.update({k: v[0] for k, v in query.items()})
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write('<h2>Job Pilotto is connected. You can close this tab.</h2>'.encode())

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    redirect = f'http://127.0.0.1:{server.server_port}'
    url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode({
        'client_id': client_id, 'redirect_uri': redirect, 'response_type': 'code', 'scope': ' '.join(SCOPES),
        'access_type': 'offline', 'prompt': 'consent', 'state': state,
        'code_challenge': challenge, 'code_challenge_method': 'S256'})
    print(f'Opening Google sign-in. If no browser opens, visit:\n{url}\n')
    thread = threading.Thread(target=server.handle_request)
    thread.start()
    open_browser(url)
    thread.join(timeout=300)
    server.server_close()
    if result.get('state') != state or 'code' not in result:
        raise SystemExit(f"Sign-in did not complete: {result.get('error', 'no answer within 5 minutes')}")
    body = urllib.parse.urlencode({'code': result['code'], 'client_id': client_id, 'client_secret': client_secret,
                                   'redirect_uri': redirect, 'grant_type': 'authorization_code',
                                   'code_verifier': verifier}).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body), timeout=20) as response:
        tokens = json.load(response)
    if 'refresh_token' not in tokens:
        raise SystemExit('Google returned no refresh token; remove Job Pilotto at myaccount.google.com/permissions and retry.')
    return tokens['refresh_token']


def load_client(path):
    """(client id, client secret) from a Desktop-app client JSON (as downloaded, or the shared one)."""
    with open(os.path.expanduser(str(path))) as handle:
        client = json.load(handle).get('installed') or {}
    if not (client.get('client_id') and client.get('client_secret')):
        raise SystemExit(f'{path} is not a Desktop app client (no "installed" section)')
    return client['client_id'], client['client_secret']


def store(client_id, client_secret, refresh_token, production, github):
    """Keychain entries (and, with github, the repository secrets) for a completed sign-in.
    A published app's sign-in doesn't expire; an app in "Testing" gets a sign-in date so the health
    check can warn before Google's 7-day limit."""
    values = {'GOOGLE_CLIENT_ID': client_id, 'GOOGLE_CLIENT_SECRET': client_secret, 'GOOGLE_REFRESH_TOKEN': refresh_token}
    user = os.getenv('USER', '')
    for name, service in KEYCHAIN.items():
        subprocess.run(['security', 'add-generic-password', '-U', '-a', user, '-s', service, '-w', values[name]], check=True)
    signed_in = '' if production else datetime.now(timezone.utc).isoformat(timespec='seconds')
    if signed_in:
        subprocess.run(['security', 'add-generic-password', '-U', '-a', user, '-s', 'job-pilotto.google.auth-at',
                        '-w', signed_in], check=True)
    else:
        subprocess.run(['security', 'delete-generic-password', '-a', user, '-s', 'job-pilotto.google.auth-at'],
                       capture_output=True)
    print('Stored in the Keychain:', ', '.join(KEYCHAIN.values()))
    if github:
        for name, value in values.items():
            subprocess.run(['gh', 'secret', 'set', name], input=value, text=True, check=True)
        if signed_in:
            subprocess.run(['gh', 'variable', 'set', 'JOB_PILOTTO_GOOGLE_AUTH_AT', '--body', signed_in], check=True)
        else:
            subprocess.run(['gh', 'variable', 'delete', 'JOB_PILOTTO_GOOGLE_AUTH_AT'], capture_output=True)
        print('Set GitHub secrets:', ', '.join(values))


def report():
    google = Google.from_env()
    if not google:
        raise SystemExit('Not connected: run `python3 -m src.sources.google auth --github`')
    now = datetime.now(timezone.utc)
    from datetime import timedelta
    print(f"Connected Gmail: {google.profile()['emailAddress']}")
    print(f"Job-related emails in the last 7 days: {len(google.search('newer_than:7d subject:(application OR applying OR interview)', 100))}")
    print(f"Calendar events in the next 14 days: {len(google.events(now, now + timedelta(days=14)))}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    auth = sub.add_parser('auth', help='one-time browser sign-in (the shared Job Pilotto app unless you give your own)')
    auth.add_argument('--client-json', help='your own Desktop app client, as downloaded from Google Cloud')
    auth.add_argument('--client-id')
    auth.add_argument('--client-secret')
    auth.add_argument('--github', action='store_true', help='also set the three GOOGLE_* repository secrets with gh')
    auth.add_argument('--production', action='store_true',
                      help="your own app is published ('In production'): the sign-in doesn't expire after 7 days")
    sub.add_parser('setup', help='guided: create your own Google app (project, APIs, consent screen, client) and sign in')
    sub.add_parser('check', help='show which account is connected and what it can see')
    sub.add_parser('status', help='one JSON line for the Mac app: connected, and which Gmail')
    verify = sub.add_parser('verify', help="wait for a sign-up's confirmation email; print its code and confirm link")
    verify.add_argument('--from', dest='sender', default='', help="sender domain or address, e.g. the employer's careers host")
    verify.add_argument('--minutes', type=int, default=15, help='only emails from the last N minutes (default 15)')
    verify.add_argument('--wait', type=int, default=180, help='keep checking for up to N seconds (default 180)')
    args = parser.parse_args(argv)
    if args.command == 'status':
        google = Google.from_env()
        try:
            print(json.dumps({'connected': True, 'email': google.profile()['emailAddress']} if google else {'connected': False}))
        except Exception as error:  # expired or revoked sign-in: the app offers Connect again
            print(json.dumps({'connected': False, 'error': str(error)[:200]}))
        return 0
    if args.command == 'verify':
        google = Google.from_env()
        if not google:
            print('Gmail is not connected (python -m src.sources.google auth).', file=sys.stderr)
            return 2
        found = wait_for_confirmation(google, args.sender, args.minutes, args.wait)
        print(json.dumps(found or {'error': 'no confirmation email yet'}))
        return 0 if found else 1
    if args.command == 'setup':
        from . import google_setup
        return google_setup.run()
    if args.command == 'auth':
        production = args.production
        if args.client_json:
            args.client_id, args.client_secret = load_client(args.client_json)
        elif not (args.client_id or args.client_secret):
            if not SHARED_CLIENT.is_file():
                parser.error('the shared Job Pilotto Google app is only bundled with the Mac app; '
                             'run `python -m src.sources.google setup` to use your own Google app instead')
            args.client_id, args.client_secret = load_client(SHARED_CLIENT)
            production = True  # the shared app is published: no 7-day expiry
            print('Using the shared Job Pilotto Google app (read-only Gmail and Calendar). '
                  'Google will say it is unverified: Advanced → Go to Job Pilotto.')
        if not (args.client_id and args.client_secret):
            parser.error('give --client-json, or both --client-id and --client-secret, or nothing for the shared app')
        token = authorize(args.client_id, args.client_secret)
        store(args.client_id, args.client_secret, token, production, args.github)
    report()
    return 0


if __name__ == '__main__':
    sys.exit(main())
