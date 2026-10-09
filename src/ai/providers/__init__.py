"""The AI engines a user can choose, each an adapter behind one contract (contract.py), and how each is built from the environment.

JOB_PILOTTO_AI_ENGINE names the engine, as the user chose it in the app (Settings → AI). Nothing is chosen for the user and nothing switches
by itself: an engine's `fallback` (another engine of the SAME family, billed) is used only on the user's own tick (`fallback_env`).
A new provider is one adapter file plus one `Engine` row here; engine.py and every AI module stay as they are. Guarded by
tests/test_ai_providers.py (every engine meets the contract) and tests/test_ai_engine.py.
"""
from dataclasses import dataclass
import os

from .contract import API, SUBSCRIPTION


@dataclass(frozen=True)
class Engine:
    name: str
    family: str          # 'claude' or 'openai'
    billing: str         # API (per token) or SUBSCRIPTION (the user's plan)
    key: str = ''        # the secret it needs, for an API engine
    local_only: bool = False   # runs the user's own CLI: this computer only, never GitHub (Always on)
    fallback: str = ''   # the engine the user may tick as the fallback when the plan's limit is hit
    fallback_env: str = 'JOB_PILOTTO_AI_FALLBACK'
    missing: str = ''    # what to say when it can't run


ENGINES = {
    'api': Engine('api', 'claude', API, key='ANTHROPIC_API_KEY',
                  missing='This needs your Anthropic API key (Settings → AI), or choose Claude Code there.'),
    'cli': Engine('cli', 'claude', SUBSCRIPTION, local_only=True, fallback='api',
                  missing='Claude Code is chosen but not found on this computer: install it (claude.com/claude-code) or switch to '
                          'an API key in Settings → AI.'),
}
DEFAULT = 'api'


def choice(env=None):
    """The chosen engine's name, as set (anything else, or nothing: the default)."""
    env = os.environ if env is None else env
    value = (env.get('JOB_PILOTTO_AI_ENGINE') or DEFAULT).strip().lower()
    return value if value in ENGINES else DEFAULT


def spec(env=None):
    return ENGINES[choice(env)]


def fallback_allowed(env=None):
    """The user ticked "use my API key when my plan's limit is hit", and that key is there."""
    env = os.environ if env is None else env
    chosen = spec(env)
    target = ENGINES.get(chosen.fallback)
    return bool(target) and (env.get(chosen.fallback_env) or '').strip().lower() == target.name and bool(env.get(target.key))


def ready(env=None):
    """Can an AI step run at all: a CLI engine chosen (it says itself when it is missing), or the chosen API engine's key present."""
    env = os.environ if env is None else env
    chosen = spec(env)
    return chosen.local_only or bool(env.get(chosen.key))


def build(env=None, action='', log=None):
    """The chosen engine's client: an adapter whose `messages.create` every AI module calls."""
    env = os.environ if env is None else env
    name = choice(env)
    if name == 'cli':
        from .claude_code import ClaudeCode, find_binary
        return ClaudeCode(binary=find_binary(env), log=log,
                          fallback=(lambda: build(dict(env, JOB_PILOTTO_AI_ENGINE='api'), action, log)) if fallback_allowed(env) else None)
    from .anthropic_api import AnthropicApi
    return AnthropicApi(action=action, log=log)


def transient_errors():
    """Every engine's "down or busy, the next run continues" errors: the contract's own and each installed SDK's."""
    from .anthropic_api import transient_errors as anthropic
    from .contract import AiUnavailable
    return (AiUnavailable, *anthropic())


def permanent_errors():
    from .anthropic_api import permanent_errors as anthropic
    return anthropic()
