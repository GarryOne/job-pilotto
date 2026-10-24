"""The one-time Google browser sign-in (loopback redirect + PKCE): consent, token exchange, and the "connected" page the browser lands on.

The token answer's `scope` says what the user really allowed (the consent screen has unticked boxes); `authorize` returns it with
the refresh token so callers keep only what works and say what is missing (src/sources/google_scopes.py). Tests: tests/test_google_scopes.py."""
import base64
import hashlib
import http.server
import json
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from typing import NamedTuple

from . import google_page, google_scopes as scopes

TOKEN_URL = 'https://oauth2.googleapis.com/token'
AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'


class SignIn(NamedTuple):
    refresh_token: str
    scopes: tuple   # the parts (gmail, calendar) the user allowed


def new_server():
    """A one-request server on a free loopback port; `respond(params) -> html` is set by wait_for_redirect."""
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            params = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).items()}
            page = self.server.respond(params)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(page.encode())

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    server.respond = lambda params: ''
    return server


def wait_for_redirect(server, respond, timeout=300):
    """Serve the one request Google's redirect makes; `respond` runs inside it so the page can show what was granted."""
    server.respond = respond
    thread = threading.Thread(target=server.handle_request)
    thread.start()
    thread.join(timeout=timeout)


def exchange(client_id, client_secret, code, redirect, verifier):
    body = urllib.parse.urlencode({'code': code, 'client_id': client_id, 'client_secret': client_secret, 'redirect_uri': redirect,
                                   'grant_type': 'authorization_code', 'code_verifier': verifier}).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body), timeout=20) as response:
        return json.load(response)


def authorize(client_id, client_secret, open_browser=webbrowser.open, only=None, theme=''):
    """Browser consent on this Mac. `only` (parts) asks for just those on a reconnect, keeping the earlier grants.
    Returns SignIn(refresh token, allowed parts); exits with a plain sentence when nothing was allowed."""
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    state, outcome = secrets.token_urlsafe(16), {}
    server = new_server()
    redirect = f'http://127.0.0.1:{server.server_port}'
    query = {'client_id': client_id, 'redirect_uri': redirect, 'response_type': 'code', 'scope': ' '.join(scopes.request_scopes(only)),
             'access_type': 'offline', 'prompt': 'consent', 'state': state,
             'code_challenge': challenge, 'code_challenge_method': 'S256'}
    if only:
        query['include_granted_scopes'] = 'true'
    url = AUTH_URL + '?' + urllib.parse.urlencode(query)
    print(f'Opening Google sign-in. If no browser opens, visit:\n{url}\n')

    def respond(params):
        if params.get('state') != state or 'code' not in params:
            outcome['error'] = params.get('error', 'no answer within 5 minutes')
            return google_page.render(None, theme, failed=outcome['error'])
        try:
            tokens = exchange(client_id, client_secret, params['code'], redirect, verifier)
        except (urllib.error.URLError, ValueError) as error:
            outcome['error'] = f'Google did not answer ({type(error).__name__})'
            return google_page.render(None, theme, failed=outcome['error'])
        outcome['tokens'], outcome['parts'] = tokens, scopes.parts_in(tokens.get('scope'))
        return google_page.render(outcome['parts'], theme)

    thread = threading.Thread(target=wait_for_redirect, args=(server, respond))
    thread.start()
    open_browser(url)
    thread.join(timeout=310)
    server.server_close()
    if 'tokens' not in outcome:
        raise SystemExit(f"Sign-in did not complete: {outcome.get('error', 'no answer within 5 minutes')}")
    if not outcome['parts']:
        raise SystemExit(scopes.say(()))
    if 'refresh_token' not in outcome['tokens']:
        raise SystemExit('Google returned no refresh token; remove Jobadabra at myaccount.google.com/permissions and retry.')
    return SignIn(outcome['tokens']['refresh_token'], outcome['parts'])
