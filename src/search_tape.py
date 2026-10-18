"""A search's tape: every web answer and every AI answer of a search, with how long each took, recorded once and replayed offline, so a change
to the search is measured on the same sources and the same answers (owner, 18 Oct 2026, change 0 of the search algorithm plan: "a fixed
replay test"; spec docs/superpowers/specs/2026-10-18-search-learns-sources.md). Used by the persona search check (tools/persona-search).

JOB_PILOTTO_SEARCH_TAPE=<folder> and JOB_PILOTTO_SEARCH_TAPE_MODE=record|replay turn it on (src/__init__.py installs it before anything else
imports urllib). Off by default: a normal run never loads it.
- The web: urllib.request.urlopen, the one way the engine reaches a site. Record keeps the body, status and time; replay serves it after the
  its recorded time times JOB_PILOTTO_TAPE_WAIT_SCALE (1 = as recorded, 0 = no wait, 0.1 = ten times faster) and a URL the tape lacks fails like an unreachable site: nothing leaves the computer.
- The AI: the engine's AI client (messages.create). Record keeps each answer and its time, keyed by the whole request; replay serves it after its
  time. A request the tape lacks (a change scoring other jobs) goes to the live engine and is added, counted in 'live' (the report says it).
  JOB_PILOTTO_TAPE_LIVE=0 (the CI replay of the Lab Job Search, no AI account there): a request the tape lacks is not asked, it is counted in
  'ai_missing' and raises, so the replay says "the tape is stale" instead of making an answer up.
Tests: tests/test_search_tape.py."""
import email.message
import hashlib
import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

_lock = threading.Lock()
_index = {}      # (kind, key) -> record, the tape read once per process
counts = {'web_tape': 0, 'web_missing': 0, 'ai_tape': 0, 'ai_live': 0, 'ai_missing': 0}


def folder():
    return Path(os.environ['JOB_PILOTTO_SEARCH_TAPE'])


def mode():
    return os.getenv('JOB_PILOTTO_SEARCH_TAPE_MODE', 'replay')


def wait_scale():
    try:
        return max(0.0, float(os.getenv('JOB_PILOTTO_TAPE_WAIT_SCALE', '1')))
    except ValueError:
        return 1.0


def _key(*parts):
    return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()[:24]


def _load():
    if _index:
        return _index
    for kind in ('web', 'ai'):
        file = folder() / f'{kind}.jsonl'
        for line in file.read_text().splitlines() if file.exists() else []:
            try:
                record = json.loads(line)
            except ValueError:
                continue
            _index.setdefault((kind, record['key']), record)   # the first answer recorded for a request is the one replayed
            if kind == 'web' and record.get('norm'):
                _index.setdefault(('norm', record['norm']), record)
            elif kind == 'web' and record.get('method') == 'POST':
                _index.setdefault(('post', record.get('url')), record)   # a tape recorded before 'norm' existed: its install POST is answered by method + address
    return _index


def _keep(kind, record, body=None):
    with _lock:
        if body is not None:
            (folder() / 'bodies').mkdir(parents=True, exist_ok=True)
            (folder() / 'bodies' / record['key']).write_bytes(body)
        folder().mkdir(parents=True, exist_ok=True)
        with open(folder() / f'{kind}.jsonl', 'a', encoding='utf-8') as file:
            file.write(json.dumps(record, ensure_ascii=False) + '\n')
        _index.setdefault((kind, record['key']), record)


_real_monotonic = time.monotonic
_skipped = [0.0]   # recorded seconds a faster replay did not wait: the virtual clock runs ahead of the real one by this much
_clock_lock = threading.Lock()


def virtual_now():
    """The clock a replay's code sees (installed as time.monotonic): real time plus the waits it skipped, so the 3-minute AI budget and the paces
    read the recorded time at any --wait-scale (18 Oct 2026: at scale 0 the budget never ran out and the replay did other work than the recording)."""
    return _real_monotonic() + _skipped[0]


def _wait(seconds):
    """One recorded call's wait, times the scale. The virtual clock then reaches where the recorded call ended: calls that wait together (threads)
    end together, so parallel waits are not added up."""
    if not seconds:
        return
    began = virtual_now()
    if wait_scale():
        time.sleep(seconds * wait_scale())
    with _clock_lock:
        _skipped[0] = max(_skipped[0], began + seconds - _real_monotonic())


# ---------- the web ----------

class _Reply(io.BytesIO):
    """What urlopen returns, enough for the engine's readers: read(), status, headers, geturl(), a context manager."""
    def __init__(self, body, record):
        super().__init__(body)
        self.status = self.code = record.get('status') or 200
        self.headers = email.message.Message()   # readers call headers.get_content_charset() / get_content_type(), as on the real reply
        self.headers['Content-Type'] = record.get('type') or 'application/octet-stream'
        self.url = record.get('final') or record['url']

    def getcode(self):
        return self.status

    def geturl(self):
        return self.url

    def info(self):
        return self.headers

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


def _request_key(request, data):
    if isinstance(request, urllib.request.Request):
        url, method, body = request.full_url, request.get_method(), request.data if data is None else data
    else:
        url, method, body = str(request), 'POST' if data is not None else 'GET', data
    body = body if isinstance(body, (bytes, type(None))) else str(body).encode()
    # the app's own page browser (src/sources/render.py) listens on a new port each run: the page asked for is in the body
    same = re.sub(r'^http://127\.0\.0\.1:\d+', 'http://app.local', url)
    return url, method, _key(method, same, hashlib.sha256(body or b'').hexdigest())


_INSTALL = re.compile(r'"install"\s*:\s*"[0-9a-f]{16,}"')


def _install_norm(method, url, body):
    """A POST that carries the install's own random id (the service's install-token): a fresh replay install has another id, so its key never matches the
    recorded one (18 Oct 2026: no token, no employer index, a different search). Its second key is method + address + the body without the id, so a changed
    purpose still misses. None for any other request."""
    text = (body or b'').decode('utf-8', 'replace')
    if method != 'POST' or not _INSTALL.search(text):
        return None
    return _key('install-post', url, _INSTALL.sub('"install": ""', text))


def _web(real):
    def urlopen(request, data=None, timeout=None, *args, **kwargs):
        url, method, key = _request_key(request, data)
        if mode() == 'replay':
            record = _load().get(('web', key))
            norm = _install_norm(method, url, request.data if isinstance(request, urllib.request.Request) and data is None else data)
            if record is None and norm:
                record = _load().get(('norm', norm)) or _load().get(('post', url))   # the second: a tape with no 'norm' on its records
            if record is None:
                counts['web_missing'] += 1
                _keep_missing_web(method, url, request, data)
                raise urllib.error.URLError(f'not on the search tape: {url}')
            counts['web_tape'] += 1
            _wait(record.get('seconds'))
            if record.get('error'):
                if record.get('status'):
                    raise urllib.error.HTTPError(url, record['status'], record['error'], {}, None)
                raise urllib.error.URLError(record['error'])
            return _Reply((folder() / 'bodies' / record['key']).read_bytes(), record)
        started = time.monotonic()
        try:
            reply = real(request, data, timeout, *args, **kwargs) if timeout is not None else real(request, data, *args, **kwargs)
            body = reply.read()
        except urllib.error.HTTPError as error:
            _keep('web', {'key': key, 'url': url, 'method': method, 'status': error.code, 'error': str(error.reason)[:200],
                          'seconds': round(time.monotonic() - started, 3)})
            raise
        except (urllib.error.URLError, OSError) as error:
            _keep('web', {'key': key, 'url': url, 'method': method, 'error': f'{type(error).__name__}: {error}'[:200],
                          'seconds': round(time.monotonic() - started, 3)})
            raise
        norm = _install_norm(method, url, request.data if isinstance(request, urllib.request.Request) and data is None else data)
        record = {'key': key, 'url': url, 'method': method, **({'norm': norm} if norm else {}), 'status': getattr(reply, 'status', 200), 'final': reply.geturl(),
                  'type': (reply.headers.get('Content-Type') if getattr(reply, 'headers', None) else '') or '',
                  'seconds': round(time.monotonic() - started, 3)}
        _keep('web', record, body)
        return _Reply(body, record)
    urlopen.search_tape = True
    return urlopen


# ---------- the AI ----------

def _response(record):
    from .ai.providers.contract import Response, TextBlock, Usage
    usage = Usage(**{k: v for k, v in (record.get('usage') or {}).items() if k in Usage.__dataclass_fields__})
    return Response(content=[TextBlock(text) for text in record.get('texts') or []], usage=usage, model=record.get('model') or '',
                    stop_reason=record.get('stop_reason') or 'end_turn', engine=record.get('engine') or '')


def _keep_missing(key, params):
    """The question a replay could not answer, in missing.jsonl beside the tape (its start, to see what differs from the recorded ones)."""
    def text(value):
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    last = (params.get('messages') or [{}])[-1].get('content', '')
    with _lock:
        with open(folder() / 'missing.jsonl', 'a', encoding='utf-8') as file:
            file.write(json.dumps({'key': key, 'model': params.get('model'), 'system': text(params.get('system', ''))[:300], 'user': text(last)[:600],
                                   'user_chars': len(text(last))}, ensure_ascii=False) + '\n')


def _keep_missing_web(method, url, request, data):
    """The page a replay could not find, in missing.jsonl beside the tape: method, address, and the body's start (what differs from the recorded request)."""
    body = request.data if isinstance(request, urllib.request.Request) and data is None else data
    body = body.decode('utf-8', 'replace') if isinstance(body, bytes) else str(body or '')
    with _lock:
        with open(folder() / 'missing.jsonl', 'a', encoding='utf-8') as file:
            file.write(json.dumps({'web': True, 'method': method, 'url': url[:400], 'body': body[:300]}, ensure_ascii=False) + '\n')


class _Messages:
    def __init__(self, live):
        self.live = live

    def create(self, **params):
        # a prompt that names today's date (job ages, "posted 3 days ago") is the same question on a later replay day
        key = _key('ai', re.sub(r'\b20\d\d-\d\d-\d\d(T[\d:.]+Z?)?\b', 'DATE', json.dumps(params, sort_keys=True, default=str)))
        record = _load().get(('ai', key)) if mode() == 'replay' else None
        if record is not None:
            counts['ai_tape'] += 1
            _wait(record.get('seconds'))
            return _response(record)
        if mode() == 'replay' and os.getenv('JOB_PILOTTO_TAPE_LIVE') == '0':
            counts['ai_missing'] += 1
            _keep_missing(key, params)
            raise RuntimeError('not on the search tape: an AI request')
        if mode() == 'replay':
            counts['ai_live'] += 1   # not on the tape: asked live (a change that asks other questions), then kept
        started = time.monotonic()
        answer = self.live().messages.create(**params)
        usage = getattr(answer, 'usage', None)
        _keep('ai', {'key': key, 'model': getattr(answer, 'model', ''), 'stop_reason': getattr(answer, 'stop_reason', 'end_turn'),
                     'engine': getattr(answer, 'engine', ''), 'seconds': round(time.monotonic() - started, 3), 'live': mode() == 'replay',
                     'texts': [block.text for block in answer.content if getattr(block, 'type', 'text') == 'text'],
                     'usage': {k: getattr(usage, k) for k in ('input_tokens', 'output_tokens', 'cache_read_input_tokens',
                                                              'cache_creation_input_tokens', 'billing', 'provider', 'model') if hasattr(usage, k)}})
        return answer


class _Client:
    """The engine's AI client stand-in: answers from the tape, builds the live client only for a request the tape lacks."""
    def __init__(self, build):
        self._build, self._live = build, None
        self.messages = _Messages(self.live)

    def live(self):
        if self._live is None:
            self._live = self._build()
        return self._live

    def __getattr__(self, name):   # anything else (a label, the engine's name) is the live client's
        return getattr(self.live(), name)


def install():
    """Put the tape in front of the web and the AI for this process (once)."""
    if getattr(urllib.request.urlopen, 'search_tape', False):
        return
    urllib.request.urlopen = _web(urllib.request.urlopen)
    if mode() == 'replay':
        time.monotonic = virtual_now   # the budget and the paces read recorded time, whatever the wait scale
    if mode() == 'replay':   # the engine checks a host is public by looking it up (careers._public): offline, every board would read as unreachable
        import socket
        real_lookup = socket.getaddrinfo
        socket.getaddrinfo = lambda host, *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 0))] \
            if host not in ('localhost', '127.0.0.1') else real_lookup(host, *a, **k)
    from .ai import providers
    real_build = providers.build
    providers.build = lambda env=None, action='', log=None: _Client(lambda: real_build(env, action, log))
    import atexit
    atexit.register(_report)


def _report():
    """One line per process in the tape's own log: how much came from the tape (the replay report sums them)."""
    try:
        folder().mkdir(parents=True, exist_ok=True)
        with open(folder() / 'report.jsonl', 'a', encoding='utf-8') as file:
            file.write(json.dumps({'mode': mode(), 'pid': os.getpid(), **counts}) + '\n')
    except OSError:
        pass
