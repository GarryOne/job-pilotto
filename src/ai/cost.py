"""API prices and per-call cost, shared by the AI stages and the cronjob run report.

USD per million tokens: (input, output, cache read); a cache write costs 1.25x input.
Anthropic first-party rates, checked 2026-09-26. An unpriced model counts as 0.
"""
PRICES = {
    'claude-opus-5-5': (4.00, 20.00, 0.20),  # interview reviews and insights (checked 2026-09-30)
    'claude-sonnet-5-5': (2.00, 10.00, 0.20),  # the model the app runs (checked 2026-10-02)
    'claude-sonnet-5': (2.00, 10.00, 0.20),    # runs logged before the switch to 5.5
    'claude-haiku-4-5': (1.00, 5.00, 0.10),
}


def usd(model, usage):
    """API cost of one call in USD, from its usage. A Claude Code call (src/ai/engine.py, billing 'subscription') is
    on the user's Claude plan, not API credits: $0."""
    if getattr(usage, 'billing', None) == 'subscription':
        return 0.0
    price_in, price_out, price_cache = PRICES.get(model, (0, 0, 0))
    cached = getattr(usage, 'cache_read_input_tokens', 0) or 0
    written = getattr(usage, 'cache_creation_input_tokens', 0) or 0
    return (usage.input_tokens * price_in + written * price_in * 1.25 + cached * price_cache
            + usage.output_tokens * price_out) / 1e6


def add(stats, model, usage):
    """Accumulate one call's tokens and cost into a stage's stats dict (no-op when stats is None)."""
    if stats is None:
        return
    stats['model'] = model
    stats['tokens_in'] = stats.get('tokens_in', 0) + usage.input_tokens
    stats['tokens_out'] = stats.get('tokens_out', 0) + usage.output_tokens
    stats['cache_read'] = stats.get('cache_read', 0) + (getattr(usage, 'cache_read_input_tokens', 0) or 0)
    stats['usd'] = stats.get('usd', 0.0) + usd(model, usage)
    # How the calls were paid for (⏱️ Search runs "Billed to"): Claude Code on the user's plan, or the API key.
    kind = 'cli_calls' if getattr(usage, 'billing', None) == 'subscription' else 'api_calls'
    stats[kind] = stats.get(kind, 0) + 1


# The AI that helps find sources (page reader, link chooser, alert emails, scout ideas) runs inside other steps; its cost is gathered here and
# logged as the run's "sources" stage, so it counts in the run's AI cost and the monthly budget like every other step.
SIDE = {}


def side(model, usage):
    """Count one source-finding call (no-op without usage: a test's fake model)."""
    if usage is not None and hasattr(usage, 'input_tokens'):
        add(SIDE, model, usage)
        SIDE['done'] = SIDE.get('done', 0) + 1


def limit_reached(error):
    """True when an API error is the account's spend limit or an empty credit balance, not a bug; or when the user's
    Claude Code can't go on (its plan's usage limit, not signed in, not installed: engine.CliLimitError)."""
    if getattr(error, 'ai_limit', False):
        return True
    text = str(error).lower()
    return 'usage limit' in text or 'credit balance' in text


def cli_limit(error):
    """The limit was the user's Claude Code (its plan, its sign-in), not the API account."""
    return bool(getattr(error, 'ai_limit', False))


def limit_reason(error):
    """The limit in a few words, for the run's log ("AI limit reached: …")."""
    return 'Claude Code (your Claude plan) cannot go on' if cli_limit(error) else 'Anthropic API spending limit'


def limit_message(error, what, retry=''):
    """The message a paused AI step sends (Telegram / the app), for the API's limit or Claude Code's."""
    if cli_limit(error):
        return f'⚠️ {what[0].upper()}{what[1:]} is paused. {error}'
    return LIMIT_MESSAGE.format(what=what, retry=retry)


LIMIT_MESSAGE = ('⚠️ The Anthropic API spend limit is reached, so {what} is paused. Raise the limit in the '
                 'Anthropic console (Settings → Limits); otherwise it resumes when the limit resets.{retry}')
