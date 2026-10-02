"""The AI engine every AI step calls through: the Anthropic API (the user's key) or the user's own Claude Code.

`client()` is the one factory. JOB_PILOTTO_AI_ENGINE picks it, as the user chose it (Settings → AI in the app):
  api (default; GitHub / Always on, the Telegram worker, the free-credit relay)  the Anthropic SDK client, as before
  cli (the app, on the user's Mac, when the user picked "Claude Code")            CliClient below
Nothing is chosen for the user: no automatic switch. JOB_PILOTTO_AI_FALLBACK=api (the user's own tick, "If Claude
Code hits my plan limit, use my API key") lets a call that hits the plan's limit go to the API key instead.

CliClient runs the user's OWN, unmodified, already signed-in `claude` binary on this computer, exactly as the user
could run it themselves (`claude -p`), so it uses their Claude plan's usage limits, not API credits. It never reads,
copies, stores, logs or forwards Claude credentials, never sets auth variables for it (it drops the API key and the
credit relay's address the app gives Python, so the CLI can't bill them), and never signs in for the user: when
Claude Code isn't signed in, the user is told to run `claude` and sign in themselves.

`CliClient.messages.create(**same arguments as the SDK)` returns an object shaped like the SDK's response
(`.content[0].type/.text`, `.usage`, `.stop_reason`, `.model`), so the AI modules work unchanged. Its usage carries
`billing = 'subscription'`: cost.py counts its tokens at $0, and the budget guard never sees it as API dollars.
"""
from dataclasses import dataclass, field
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ENGINES = ('api', 'cli')
SUBSCRIPTION = 'subscription'
# Claude Code's model aliases for our model ids (the alias follows Claude Code's own latest model of that family).
ALIASES = (('claude-haiku', 'haiku'), ('claude-sonnet', 'sonnet'), ('claude-opus', 'opus'))
TIMEOUT_S = 240  # a hard stop per call; a call that reads files (the interview review: long transcripts) gets at least FILES_TIMEOUT_S
FILES_TIMEOUT_S = 600
TIMEOUTS_BEFORE_STOP = 2  # in a row: Claude Code is not answering at all, so the run stops instead of waiting for every job
PARALLEL = 2     # Claude Code processes at once, whatever a module's thread pool (score.py runs 5)
# Tools a text call never needs, for a Claude Code too old for --tools.
DENY = ('Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Glob', 'Grep', 'Read')
_slots = threading.BoundedSemaphore(PARALLEL)
_help = {}


def choice(env=None):
    """'api' or 'cli', as set (anything else, or nothing: 'api')."""
    env = os.environ if env is None else env
    value = (env.get('JOB_PILOTTO_AI_ENGINE') or 'api').strip().lower()
    return value if value in ENGINES else 'api'


def fallback_allowed(env=None):
    """The user ticked "use my API key when Claude Code hits my plan limit", and a key is there."""
    env = os.environ if env is None else env
    return (env.get('JOB_PILOTTO_AI_FALLBACK') or '').strip().lower() == 'api' and bool(env.get('ANTHROPIC_API_KEY'))


def ready(env=None):
    """Can an AI step run at all: Claude Code chosen, or an API key present."""
    env = os.environ if env is None else env
    return choice(env) == 'cli' or bool(env.get('ANTHROPIC_API_KEY'))


def missing_text(env=None):
    return ('Claude Code is chosen but not found on this computer: install it (claude.com/claude-code) or switch to '
            'an API key in Settings → AI.' if choice(env) == 'cli' else
            'This needs your Anthropic API key (Settings → AI), or choose Claude Code there.')


ACTIONS = ('enrich', 'score', 'kit', 'prep', 'insight', 'mail', 'inbox', 'review', 'interview', 'opportunity', 'added', 'import')


def _api(action=''):
    """The SDK client. `action` names the AI step (one of ACTIONS) in a header the free-credit relay reads, so what each step costs can be
    told apart there (site/src/trial.js); Anthropic itself ignores it. Nothing about the job or the user is in it."""
    import anthropic
    return anthropic.Anthropic(default_headers={'x-jp-action': action}) if action in ACTIONS else anthropic.Anthropic()


def client(env=None, action=''):
    """The AI client for this run, as the user chose it."""
    env = os.environ if env is None else env
    if choice(env) == 'cli':
        return CliClient(binary=find_binary(env), fallback=(lambda: _api(action) if action else _api()) if fallback_allowed(env) else None)
    return _api(action) if action else _api()


def label(usage_or_stats):
    """How a call or a stage was paid for, in words."""
    billing = getattr(usage_or_stats, 'billing', None) if not isinstance(usage_or_stats, dict) else (
        SUBSCRIPTION if usage_or_stats.get('cli_calls') else None)
    return 'Claude Code (your plan)' if billing == SUBSCRIPTION else 'Anthropic API'


# ---------- the binary ----------

def find_binary(env=None, exists=os.path.exists):
    """The user's `claude`: as the app found it (JOB_PILOTTO_CLAUDE_BIN), else on PATH, else where the installers put
    it (an app opened from the Finder has no shell PATH)."""
    env = os.environ if env is None else env
    given = env.get('JOB_PILOTTO_CLAUDE_BIN')
    if given and exists(given):
        return given
    on_path = shutil.which('claude', path=env.get('PATH'))
    if on_path:
        return on_path
    home = Path(env.get('HOME') or Path.home())
    for place in (home / '.local' / 'bin' / 'claude', home / '.claude' / 'local' / 'claude',
                  Path('/opt/homebrew/bin/claude'), Path('/usr/local/bin/claude')):
        if exists(str(place)):
            return str(place)
    return ''


def flags(binary, run=subprocess.run):
    """The flags this Claude Code offers (from `claude --help`, once per binary)."""
    if binary not in _help:
        try:
            out = run([binary, '--help'], capture_output=True, text=True, timeout=30, env=cli_env())
            text = (out.stdout or '') + (out.stderr or '')
        except (OSError, subprocess.SubprocessError):
            text = ''
        _help[binary] = set(re.findall(r'(--[a-z][a-z-]+)', text))
    return _help[binary]


def cli_env(parent=None):
    """The environment Claude Code runs in: the user's own, minus what the app added for Python's API calls (the
    API key and the credit relay's address), so it runs on the user's Claude sign-in. Nothing is added."""
    env = dict(os.environ if parent is None else parent)
    for name in ('ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'):
        env.pop(name, None)
    return env


def alias(model):
    for prefix, name in ALIASES:
        if str(model).startswith(prefix):
            return name
    return model


# ---------- errors ----------

class CliError(RuntimeError):
    """Claude Code didn't give an answer (timeout, a crash, unreadable output)."""


class CliLimitError(CliError):
    """The user's Claude plan limit is reached, or Claude Code can't run (not signed in, not installed). Like the
    API's spend limit (cost.limit_reached): every other call would fail too, so the run stops and says why."""
    ai_limit = True


LIMIT = re.compile(r'usage limit|hit your (?:usage )?limit|limit reached|limit will reset|rate.?limit|out of (?:extra )?usage'
                   r'|too many requests|\b429\b', re.I)
SIGNED_OUT = re.compile(r'not logged in|please run /login|run /login|invalid api key|authentication_error|oauth token'
                        r'|not authenticated|login required|/login', re.I)
LIMIT_TEXT = ('Claude Code: your Claude usage window is exhausted (the plan\'s usage limit), so this AI step is paused; '
              'try again later, when the limit resets.')
SIGNED_OUT_TEXT = ('Claude Code is not signed in on this computer: open Terminal, run `claude` '
                   'and sign in with your Claude account, then try again. Or switch to an API key in Settings → AI.')
NOT_ANSWERING_TEXT = ('Claude Code did not answer twice in a row (each waited {seconds} s), so this AI step stops instead of waiting for every job. '
                      'It may be signed out or waiting for you: open Terminal, run `claude`, check it answers, then run again. '
                      'Or switch to an API key in Settings → AI.')
MISSING_TEXT = ('Claude Code was not found on this computer: install it from '
                'claude.com/claude-code and sign in, or switch to an API key in Settings → AI.')


def classify(text):
    """A Claude Code failure as the error to raise."""
    if SIGNED_OUT.search(text or ''):
        return CliLimitError(SIGNED_OUT_TEXT)
    if LIMIT.search(text or ''):
        return CliLimitError(LIMIT_TEXT)
    return CliError(f'Claude Code failed: {(text or "no output").strip()[:300]}')


# ---------- the response, shaped like the SDK's ----------

@dataclass
class TextBlock:
    text: str
    type: str = 'text'


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    billing: str = SUBSCRIPTION


@dataclass
class Response:
    content: list
    usage: Usage
    model: str
    stop_reason: str = 'end_turn'
    engine: str = 'cli'
    raw: dict = field(default_factory=dict, repr=False)


# ---------- a tiny JSON-schema check (enough for our schemas: types, required keys, enums) ----------

TYPES = {'object': dict, 'array': list, 'string': str, 'boolean': bool, 'null': type(None)}


def problems(value, schema, where='$'):
    """What makes value not match schema (empty: it matches)."""
    if not isinstance(schema, dict):
        return []
    if 'anyOf' in schema:
        return [] if any(not problems(value, s, where) for s in schema['anyOf']) else [f'{where}: matches no option']
    kinds = schema.get('type')
    kinds = kinds if isinstance(kinds, list) else [kinds] if kinds else []
    if kinds and not any(_is(value, kind) for kind in kinds):
        return [f'{where}: expected {"/".join(kinds)}']
    if 'enum' in schema and value not in schema['enum']:
        return [f'{where}: {value!r} is not one of {schema["enum"]}']
    found = []
    if isinstance(value, dict):
        for key in schema.get('required', []):
            if key not in value:
                found.append(f'{where}.{key}: missing')
        for key, sub in (schema.get('properties') or {}).items():
            if key in value:
                found += problems(value[key], sub, f'{where}.{key}')
    if isinstance(value, list) and isinstance(schema.get('items'), dict):
        for i, item in enumerate(value[:200]):
            found += problems(item, schema['items'], f'{where}[{i}]')
    return found


def _is(value, kind):
    if kind == 'integer':
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == 'number':
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, TYPES.get(kind, object))


def parse_json(text):
    """The JSON in an answer: all of it, else a fenced block, else the outermost {...}."""
    text = (text or '').strip()
    for candidate in (text, *re.findall(r'```(?:json)?\s*(.*?)```', text, re.S),
                      text[text.find('{'):text.rfind('}') + 1] if '{' in text else ''):
        try:
            return json.loads(candidate)
        except (ValueError, TypeError):
            continue
    raise ValueError('not JSON')


# ---------- the client ----------

def _text_of(content):
    if isinstance(content, str):
        return content
    return '\n\n'.join(block.get('text', '') for block in content if isinstance(block, dict) and block.get('type') == 'text')


def _system_text(system):
    if not system:
        return ''
    return system if isinstance(system, str) else _text_of(system)


EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
       'application/pdf': 'pdf'}


def prompt_and_files(messages, folder):
    """The conversation as one prompt, and the images/PDFs written into folder (the only place Claude may read)."""
    import base64
    parts, files = [], []
    many = len(messages) > 1
    for message in messages:
        content = message.get('content')
        blocks = [{'type': 'text', 'text': content}] if isinstance(content, str) else list(content or [])
        texts = []
        for block in blocks:
            kind = block.get('type')
            if kind == 'text':
                texts.append(block.get('text', ''))
            elif kind in ('image', 'document') and (block.get('source') or {}).get('type') == 'base64':
                source = block['source']
                name = f"{'image' if kind == 'image' else 'document'}-{len(files) + 1}.{EXT.get(source.get('media_type'), 'bin')}"
                (Path(folder) / name).write_bytes(base64.b64decode(source['data']))
                files.append(name)
                texts.append(f'[attached file: ./{name}]')
        text = '\n\n'.join(t for t in texts if t)
        parts.append(f"{message.get('role', 'user').upper()}:\n{text}" if many else text)
    prompt = '\n\n'.join(parts)
    if files:
        prompt = ('First read each attached file with the Read tool, in this order: '
                  + ', '.join(f'./{name}' for name in files) + '. Then answer.\n\n' + prompt)
    return prompt, files


class CliClient:
    """A drop-in for anthropic.Anthropic() (messages.create only) that runs the user's own Claude Code."""

    def __init__(self, binary=None, fallback=None, run=subprocess.run, timeout=None, log=None):
        self.binary = binary if binary is not None else find_binary()
        self.fallback, self.run, self._api = fallback, run, None
        self.timeout = timeout or int(os.getenv('JOB_PILOTTO_CLI_TIMEOUT') or TIMEOUT_S)
        self.log = log or (lambda text: print(text, file=sys.stderr, flush=True))
        self._timeouts = 0  # consecutive calls that timed out
        self.messages = self

    def create(self, **params):
        if self._api is not None:  # the plan's limit was hit earlier in this run and the user allowed the API
            return self._api.messages.create(**params)
        try:
            return self._create(**params)
        except CliLimitError as error:
            if not self.fallback or error.args[0] == MISSING_TEXT:
                raise
            self.log(f'Warning: {error} Using your Anthropic API key for the rest of this run (Settings → AI: '
                     '"If Claude Code hits my plan limit, use my API key").')
            self._api = self.fallback()
            return self._api.messages.create(**params)

    def command(self, model, system, schema=None, effort=None, with_files=False):
        offered = flags(self.binary, self.run)
        args = [self.binary, '-p', '--output-format', 'json', '--model', alias(model)]
        if system:
            args += ['--system-prompt', system]
        if with_files:  # Read only, and only this call's own folder (the working directory); nothing asks
            args += ['--tools', 'Read'] if '--tools' in offered else ['--disallowedTools', ','.join(d for d in DENY if d != 'Read')]
            args += ['--allowedTools', 'Read(./**)']
        else:
            args += ['--tools', ''] if '--tools' in offered else ['--disallowedTools', ','.join(DENY)]
        if '--permission-mode' in offered:
            args += ['--permission-mode', 'dontAsk']  # anything not allowed above is refused, never asked
        if schema is not None and '--json-schema' in offered:
            args += ['--json-schema', json.dumps(schema)]
        if effort and '--effort' in offered:
            args += ['--effort', effort]
        if '--max-turns' in offered:
            # One turn for a plain answer; reading files or a structured answer takes Claude Code a few steps.
            args += ['--max-turns', '1' if not with_files and schema is None else str(3 + 2 * with_files)]
        for flag in ('--no-session-persistence', '--strict-mcp-config', '--safe-mode'):
            if flag in offered:
                args.append(flag)
        return args

    def _call(self, args, prompt, folder):
        if not self.binary:
            raise CliLimitError(MISSING_TEXT)
        if self._timeouts >= TIMEOUTS_BEFORE_STOP:  # it already failed to answer: nothing waits again in this run
            raise CliLimitError(NOT_ANSWERING_TEXT.format(seconds=self.timeout))
        wait = max(self.timeout, FILES_TIMEOUT_S) if '--allowedTools' in args and not os.getenv('JOB_PILOTTO_CLI_TIMEOUT') else self.timeout
        with _slots:
            try:
                out = self.run(args, input=prompt, capture_output=True, text=True, timeout=wait, cwd=folder,
                               env=cli_env())
            except subprocess.TimeoutExpired:
                self._timeouts += 1
                if self._timeouts >= TIMEOUTS_BEFORE_STOP:
                    raise CliLimitError(NOT_ANSWERING_TEXT.format(seconds=wait)) from None
                raise CliError(f'Claude Code did not answer within {wait} s') from None
            except OSError as error:
                raise CliLimitError(MISSING_TEXT) from error
        self._timeouts = 0
        try:
            data = json.loads(out.stdout)
            if isinstance(data, list):  # a stream of events: the result is the last one
                data = next(item for item in reversed(data) if item.get('type') == 'result')
        except (ValueError, StopIteration, AttributeError):
            raise classify(f'{out.stdout}\n{out.stderr}'.strip() or f'exit code {out.returncode}') from None
        if data.get('is_error') or out.returncode != 0 or str(data.get('subtype', 'success')).startswith('error'):
            if data.get('subtype') == 'error_max_turns':
                return data, 'max_turns'
            raise classify(f"{data.get('result') or ''}\n{out.stderr or ''}\n{data.get('subtype') or ''}")
        return data, 'end_turn'

    def _create(self, model, messages, system=None, output_config=None, max_tokens=None, **_):
        config = output_config or {}
        schema = (config.get('format') or {}).get('schema') if (config.get('format') or {}).get('type') == 'json_schema' else None
        with tempfile.TemporaryDirectory(prefix='job-pilotto-claude-') as folder:
            prompt, files = prompt_and_files(messages, folder)
            system_text = _system_text(system)
            args = self.command(model, system_text, schema, config.get('effort'), with_files=bool(files))
            native = schema is not None and '--json-schema' in args
            if schema is not None and not native:
                prompt += ('\n\nAnswer with only one JSON object (no prose, no code fence) that matches this JSON '
                           f'schema:\n{json.dumps(schema)}')
            data, stop = self._call(args, prompt, folder)
            usage = usage_of(data)
            text = self._answer(data, schema)
            if schema is not None and stop == 'end_turn':
                try:
                    found = problems(parse_json(text), schema)
                except ValueError:
                    found = ['not JSON']
                if found:  # repaired once: the same question, with what was wrong
                    self.log(f'Warning: Claude Code answer did not match the schema ({"; ".join(found[:3])}); asking once more')
                    again = (f'{prompt}\n\nYour previous answer was not valid ({"; ".join(found[:5])}):\n{text[:6000]}\n\n'
                             'Answer again with only the corrected JSON object.')
                    data, stop = self._call(args, again, folder)
                    usage = _plus(usage, usage_of(data))
                    text = self._answer(data, schema)
                    try:
                        if problems(parse_json(text), schema):
                            raise ValueError('schema')
                    except ValueError:
                        raise CliError('Claude Code gave no valid JSON answer for this step (twice)') from None
                text = json.dumps(parse_json(text), ensure_ascii=False)
        return Response(content=[TextBlock(text)], usage=usage, model=model, stop_reason=stop, raw=data)

    @staticmethod
    def _answer(data, schema):
        if schema is not None and data.get('structured_output') is not None:
            return json.dumps(data['structured_output'], ensure_ascii=False)
        return str(data.get('result') or '')


def usage_of(data):
    usage = data.get('usage') or {}
    number = lambda key: int(usage.get(key) or 0)
    return Usage(number('input_tokens'), number('output_tokens'), number('cache_read_input_tokens'),
                 number('cache_creation_input_tokens'))


def _plus(a, b):
    return Usage(a.input_tokens + b.input_tokens, a.output_tokens + b.output_tokens,
                 a.cache_read_input_tokens + b.cache_read_input_tokens,
                 a.cache_creation_input_tokens + b.cache_creation_input_tokens)
