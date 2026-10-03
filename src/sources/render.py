"""Pages that only exist after JavaScript runs, read with a headless browser. Optional: needs `pip install playwright` and
`playwright install chromium` (requirements-render.txt); without them every function here says "not available" and the scout carries on.

What it is for: a company's public careers page built in the browser (the HTML a plain request gets is an empty shell). What it is not for:
getting past a site that refuses automated visitors. It shows who it is (the same user agent as every other request, plus "browser"),
reads robots.txt first, waits between pages of one site, loads no images, fonts or media, and gives up at the first 401/403/429 or
bot-check page. A refusal is an answer. No stealth settings, no fingerprint changes, no proxies, no CAPTCHA solving.
"""
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.parse
import urllib.robotparser

from . import ats, careers

TIMEOUT_MS = 20000
SETTLE_MS = 1500          # after the page loads, for the lists a script fills in
HOST_DELAY_S = 1.0        # between two pages of one site
MAX_PAGES = 60            # per process: a run is not a crawl of the web
CHALLENGE = ('just a moment', 'attention required', 'verify you are human', 'captcha', 'access denied', 'are you a robot')


class Refused(Exception):
    """The site answered 401/403/429 or showed a bot check: not retried, not worked around."""


# Playwright's sync API belongs to the thread that started it: every browser call runs on this one worker thread, one page at a time.
_worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix='render')
_state = {'playwright': None, 'browser': None, 'pages': 0, 'last': {}, 'robots': {}}


def available():
    """Playwright is installed (the browser itself is checked when it first starts)."""
    try:
        import playwright.sync_api  # noqa: F401
        return True
    except ImportError:
        return False


def _browser():
    if not _state['browser']:
        from playwright.sync_api import sync_playwright
        _state['playwright'] = sync_playwright().start()
        _state['browser'] = _state['playwright'].chromium.launch(headless=True)
    return _state['browser']


def close():
    """Stop the browser (on its own thread). Safe to call when it never started."""
    def stop():
        for key in ('browser', 'playwright'):
            thing = _state[key]
            _state[key] = None
            try:
                thing and (thing.close() if key == 'browser' else thing.stop())
            except Exception:  # noqa: BLE001
                pass
    _worker.submit(stop).result()


def _allowed(url):
    parts = urllib.parse.urlsplit(url)
    origin = f'{parts.scheme}://{parts.netloc}'
    if origin not in _state['robots']:
        robots = urllib.robotparser.RobotFileParser()
        try:
            robots.parse(careers.get_text(f'{origin}/robots.txt').splitlines())
        except Exception:  # noqa: BLE001 — no readable robots file: no objection
            robots.parse([])
        _state['robots'][origin] = robots
    return _state['robots'][origin].can_fetch(ats.USER_AGENT, url)


def render(url):
    """The page's HTML after its scripts ran. Raises Refused, ValueError (not allowed) or the browser's own errors; one page at a time."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or not careers._public(parts.hostname):
        raise ValueError('not a public web address')
    return _worker.submit(_render, url, parts).result()


def _render(url, parts):
    if _state['pages'] >= MAX_PAGES:
        raise ValueError('page limit for this run reached')
    if not _allowed(url):
        raise ValueError('robots.txt asks not to fetch this page')
    wait = HOST_DELAY_S - (time.monotonic() - _state['last'].get(parts.hostname, 0))
    if wait > 0:
        time.sleep(wait)
    context = _browser().new_context(user_agent=f'{ats.USER_AGENT} browser', java_script_enabled=True)
    try:
        context.route('**/*', lambda route: route.abort() if route.request.resource_type in ('image', 'media', 'font') else route.continue_())
        page = context.new_page()
        response = page.goto(url, wait_until='domcontentloaded', timeout=TIMEOUT_MS)
        if response is not None and response.status in (401, 403, 429):
            raise Refused(f'HTTP {response.status}')
        page.wait_for_timeout(SETTLE_MS)
        markup = page.content()
    finally:
        context.close()
        _state['pages'] += 1
        _state['last'][parts.hostname] = time.monotonic()
    if any(word in markup[:6000].lower() for word in CHALLENGE) and len(markup) < 20000:
        raise Refused('bot check page')
    return markup
