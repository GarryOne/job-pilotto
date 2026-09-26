"""API prices and per-call cost, shared by the AI stages and the cronjob run report.

USD per million tokens: (input, output, cache read); a cache write costs 1.25x input.
Anthropic first-party rates, checked 2026-09-26. An unpriced model counts as 0.
"""
PRICES = {
    'claude-sonnet-5': (2.00, 10.00, 0.20),
    'claude-haiku-4-5': (1.00, 5.00, 0.10),
}


def usd(model, usage):
    """API cost of one call in USD, from its usage."""
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
