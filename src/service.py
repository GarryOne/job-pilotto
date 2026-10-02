"""The Job Pilotto service as the engine sees it: a random local install id, the token the website gives that id, and the private
playbook (per-board notes for application sessions, learned over many applications and kept on our side).

Nothing about the user goes up: the id is random and local. Every call here fails soft ('' / None): the engine works without the service.
"""
import json
import os
import re
import secrets
import urllib.parse
import urllib.request

from .paths import DATA
from .sources import ats

SITE = 'https://www.jobpilotto.workers.dev'
TIMEOUT = 10
ID_FILE = DATA / 'install_id'
_ID = re.compile(r'[A-Za-z0-9_-]{8,64}')


def install_id(path=None, env=None):
    """The shared id the app set (JOB_PILOTTO_INSTALL_ID), else a random one kept next to the data."""
    given = (env if env is not None else os.environ).get('JOB_PILOTTO_INSTALL_ID', '')
    if _ID.fullmatch(given):
        return given
    path = path or ID_FILE
    try:
        stored = path.read_text().strip()
        if _ID.fullmatch(stored):
            return stored
    except OSError:
        pass
    fresh = secrets.token_hex(12)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(fresh + '\n')
    except OSError:
        pass   # an id that is not kept is still valid for this run
    return fresh


def _post(url, body):
    request = urllib.request.Request(url, method='POST', data=json.dumps(body).encode(),
                                     headers={'User-Agent': ats.USER_AGENT, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def _get(url, headers):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT, **headers})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def playbook(board, base=None, install=None, post=_post, get=_get):
    """The private notes for one board ('greenhouse', 'ashby', 'lever', 'other'), or '' when unavailable."""
    base = (base or os.getenv('JOB_PILOTTO_SITE') or SITE).rstrip('/')
    try:
        install = install or install_id()
        token = str(post(f'{base}/api/install-token', {'install': install}).get('token') or '')
        if not token:
            return ''
        answer = get(f'{base}/api/playbook?board={urllib.parse.quote(str(board).lower())}',
                     {'Authorization': f'Bearer {token}', 'X-Install-Id': install})
        return str(answer.get('text') or '')
    except Exception:  # noqa: BLE001 — the playbook is a bonus: any trouble means "none"
        return ''
