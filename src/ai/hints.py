"""Scoring hints learned from what people dismiss (site/src/intelligence.js hints, fetched by desktop/lib/aliases.js into data/hints.json).

The site sends only a fixed reason word and its share; the sentence the scorer reads is written here, so nothing from the network can
become prompt text. No file, an unreadable file or an old one: no hints, and the score reads exactly as before."""
import json
import time

from .. import paths

TEMPLATES = {
    'seniority': 'check the seniority the posting asks for against the candidate\'s level (too senior and too junior both miss)',
    'location': 'check where the job is really based and whether remote means the candidate\'s own country',
    'tech': 'check the posting\'s required technologies against the candidate\'s actual stack, not just the title',
    'company': 'check what the company does and its size and stage against the candidate\'s stated preferences',
    'role': 'check that the day-to-day work is the kind of role the candidate wants, whatever the title says',
}
MAX_AGE_DAYS = 14


def _file():
    return paths.DATA / 'hints.json'


def load(now=None):
    """-> [reason, ...] from a fresh hints file, most common first (at most 3)."""
    try:
        data = json.loads(_file().read_text())
    except (OSError, ValueError):
        return []
    now = now if now is not None else time.time() * 1000
    if not isinstance(data, dict) or now - float(data.get('at') or 0) > MAX_AGE_DAYS * 86400000:
        return []
    return [item['reason'] for item in (data.get('hints') or [])[:3] if isinstance(item, dict) and item.get('reason') in TEMPLATES]


def text(reasons):
    """The paragraph appended to the scoring prompt, or ''."""
    if not reasons:
        return ''
    lines = '\n'.join(f'- {TEMPLATES[reason]}' for reason in reasons)
    return ('\n\nWhat other candidates most often dismiss jobs for (aggregate, anonymous). Weigh these with extra care, '
            f'and say so in your reasoning only if one applies:\n{lines}')
