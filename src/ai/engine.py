"""The AI engine every AI step calls through: one factory, `client()`, over the engines in src/ai/providers/.

JOB_PILOTTO_AI_ENGINE picks it, as the user chose it (Settings → AI in the app):
  api (default; GitHub / Always on, the Telegram worker, the free-credit relay)  the Anthropic SDK (providers/anthropic_api.py)
  cli (the app, on the user's Mac, when the user picked "Claude Code")            the user's own Claude Code (providers/claude_code.py)
Nothing is chosen for the user: no automatic switch. JOB_PILOTTO_AI_FALLBACK=api (the user's own tick, "If Claude
Code hits my plan limit, use my API key") lets a call that hits the plan's limit go to the API key instead.

Every engine is an adapter behind one contract (providers/contract.py): `client().messages.create(**the SDK's arguments)` returns an
object shaped like the Anthropic SDK's response (`.content[0].type/.text`, `.usage`, `.stop_reason`, `.model`), so the AI modules work
unchanged. A plan's usage carries `billing = 'subscription'`: cost.py counts its tokens at $0, and the budget guard never sees it as API dollars.
This file keeps the names the modules and tests import; the engines' own code lives in providers/.
"""
import os

from . import providers
from .providers import choice, fallback_allowed, ready  # noqa: F401 (the engine's public names)
from .providers.anthropic_api import ACTIONS, sdk as _api  # noqa: F401
from .providers.cli_base import CliError, CliLimitError, EXT, FILES_TIMEOUT_S, TIMEOUT_S, TIMEOUTS_BEFORE_STOP  # noqa: F401
from .providers.claude_code import (  # noqa: F401
    ALIASES, DENY, LIMIT, LIMIT_TEXT, MISSING_TEXT, NOT_ANSWERING_TEXT, PARALLEL, SIGNED_OUT, SIGNED_OUT_TEXT,
    ClaudeCode as CliClient, _help, alias, call_env, classify, cli_env, find_binary, flags, thinking_tokens, timing_line, usage_of)
from .providers.contract import (  # noqa: F401
    API, SUBSCRIPTION, AiError, AiLimit, AiUnavailable, Response, TextBlock, Usage)
from .providers.schema import parse_json, problems, without_limits  # noqa: F401

ENGINES = tuple(providers.ENGINES)


def missing_text(env=None):
    return providers.spec(env).missing


def client(env=None, action=''):
    """The AI client for this run, as the user chose it."""
    return providers.build(os.environ if env is None else env, action)


def transient_errors():
    """Errors after which the run stops and the next one continues (the provider is down or busy), whatever the engine."""
    return providers.transient_errors()


def permanent_errors():
    """A provider's refusal of this one call (a bad request): the job is skipped, the run goes on."""
    return providers.permanent_errors()


def effort_for(model, effort='medium'):
    """The effort a call sends, or None to send none. Haiku 4.5 rejects the setting with a 400. Haiku 5.5 thinks by default
    (Haiku 4.5 never did), and the thinking counts towards a call's small max_tokens: it always runs at low (8 Oct 2026)."""
    if model.startswith('claude-haiku-4'):
        return None
    return 'low' if model.startswith('claude-haiku') else effort


def structured(schema, model, effort='medium'):
    """The `output_config` of a schema-constrained call: the JSON schema, and the effort setting (effort_for)."""
    config = {'format': {'type': 'json_schema', 'schema': without_limits(schema)}}
    if effort_for(model, effort):
        config['effort'] = effort_for(model, effort)
    return config


def label(usage_or_stats):
    """How a call or a stage was paid for, in words."""
    billing = getattr(usage_or_stats, 'billing', None) if not isinstance(usage_or_stats, dict) else (
        SUBSCRIPTION if usage_or_stats.get('cli_calls') else None)
    return 'Claude Code (your plan)' if billing == SUBSCRIPTION else 'Anthropic API'
