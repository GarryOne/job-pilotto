"""How much of the market does the search catch? The funnel of one crawl, and the near misses.

A crawl fetches every posting of every feed, keeps those with a wanted title in a wanted place, and drops the rest without a word.
When the role keywords are narrow that silently hides most of the relevant market (owner, 2 Oct 2026: 3,142 postings in his places,
164 matched, "distributed systems", his top interest, was not a keyword). This counts, per crawl: postings fetched, in the wanted
places, matched by the role keywords; and, among the in-place postings no keyword matched, how many titles contain each of a list of
engineering role terms, with examples, so the app can say "your keywords catch 5%; adding backend would add 49" and let the user choose.
No AI and no network: it only counts what the crawl already fetched.
"""
import json
import re
from datetime import datetime, timezone

from .paths import DATA

FILE = DATA / 'coverage.json'
# Engineering role terms a user might want to add, as plain words (shown to the user; matched in titles, any case).
VOCAB = ('distributed systems', 'systems engineer', 'backend', 'back-end', 'full stack', 'software engineer', 'data platform',
         'data infrastructure', 'data engineer', 'security engineer', 'machine learning', 'ml engineer', 'performance engineer',
         'storage', 'networking', 'database', 'release engineer', 'build engineer', 'devsecops', 'operations engineer', 'sdet')
EXAMPLES = 3
NARROW_BELOW = 0.10   # the keywords catch under a tenth of the in-place postings that are engineering roles: say so


def _pattern(term):
    """The term as it appears in a title: a space and a hyphen are the same ("back-end" finds "Back End"), whole words only."""
    words = [re.escape(word) for word in re.split(r'[\s-]+', term.strip()) if word]
    return re.compile(r'(?<![a-z])' + r'[\s-]'.join(words) + r'(?![a-z])', re.I)


class Tally:
    """Counts one crawl. add() takes each fetched posting with the three decisions the crawl already made."""

    def __init__(self, vocab=VOCAB):
        self.fetched = self.in_places = self.matched = self.feeds = 0
        self.vocab = {term: _pattern(term) for term in vocab}
        self.near = {term: {'count': 0, 'examples': []} for term in vocab}

    def feed(self):
        self.feeds += 1

    def add(self, title, in_place, matched, excluded=False):
        self.fetched += 1
        if not in_place or excluded:
            return
        self.in_places += 1
        if matched:
            self.matched += 1
            return
        for term, pattern in self.vocab.items():
            if pattern.search(title or ''):
                entry = self.near[term]
                entry['count'] += 1
                if len(entry['examples']) < EXAMPLES and title not in entry['examples']:
                    entry['examples'].append(title)

    def summary(self, now=None):
        suggestions = sorted(({'term': term, **entry} for term, entry in self.near.items() if entry['count'] >= 2),
                             key=lambda item: -item['count'])
        return {'at': (now or datetime.now(timezone.utc)).isoformat(timespec='seconds'), 'feeds': self.feeds, 'fetched': self.fetched,
                'in_places': self.in_places, 'matched': self.matched, 'suggestions': suggestions}


def save(summary, path=FILE):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(summary, ensure_ascii=False, indent=1) + '\n')
    except OSError:
        pass   # a number for the Strategy page is never worth failing a crawl


def load(path=FILE):
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) and 'in_places' in data else None
    except (OSError, ValueError):
        return None


def verdict(summary, keywords=()):
    """What to tell the user: {'narrow': bool, 'share': matched / in_places, 'suggestions': those not already keywords}.
    Narrow = the keywords catch under NARROW_BELOW of the in-place postings AND some listed term would add at least 5 more."""
    if not summary or not summary.get('in_places'):
        return None
    have = {str(word).lower() for word in keywords}
    suggestions = [s for s in summary.get('suggestions', []) if s['term'].lower() not in have]
    share = summary['matched'] / summary['in_places']
    return {'narrow': share < NARROW_BELOW and any(s['count'] >= 5 for s in suggestions), 'share': share, 'matched': summary['matched'],
            'in_places': summary['in_places'], 'fetched': summary['fetched'], 'feeds': summary['feeds'], 'at': summary.get('at'),
            'suggestions': suggestions[:8]}
