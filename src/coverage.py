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
# The same kinds of role in the languages job titles are written in across Europe (German, French, Italian, Spanish, Dutch, Polish):
# an English-only search silently misses them. Offered like the words above; marked so the card can say why.
LOCAL_VOCAB = ('systemtechniker', 'systemingenieur', 'systemadministrator', 'informatiker', 'plattform', 'infrastruktur', 'cloud-ingenieur',
               'betriebsingenieur', 'netzwerktechniker', 'softwareentwickler', 'entwickler', 'applikationsentwickler', 'dateningenieur',
               'ingénieur système', 'ingénieur systèmes', 'ingénieur cloud', 'ingénieur devops', 'ingénieur infrastructure', 'ingénieur logiciel',
               'administrateur système', 'administrateur systèmes', 'développeur', 'ingénieur réseau', 'sistemista', 'sviluppatore',
               'ingegnere cloud', 'ingegnere devops', 'amministratore di sistema', 'ingeniero devops', 'ingeniero cloud', 'desarrollador',
               'ontwikkelaar', 'systeembeheerder', 'programista', 'administrator systemów')
VOCAB = VOCAB + LOCAL_VOCAB
LOCAL_MIN = 3   # a local-language word with at least this many missed postings is worth saying, however broad the search already is
EXAMPLES = 3
# Places a user with EU work rights could add, as a fixed list (label shown, regex fragment written into the search settings' "abroad"
# places). The app only ever adds a fragment offered here: fixed words in, nothing typed by a server or a posting.
PLACE_OPTIONS = (
    ('United Kingdom', r'\bunited\ kingdom\b|\buk\b|\bengland\b|\bscotland\b|\bwales\b|\bbristol\b|\bcambridge\b|\bmanchester\b|\bedinburgh\b|\bbelfast\b'),
    ('Ireland', r'\bireland\b|\bdublin\b|\bcork\b'),
    ('Netherlands', r'\bnetherlands\b|\bamsterdam\b|\brotterdam\b|\butrecht\b|\beindhoven\b'),
    ('France', r'\bfrance\b|\bparis\b|\blyon\b'),
    ('Germany', r'\bgermany\b|\bdeutschland\b|\bmunich\b|\bm[uü]nchen\b|\bhamburg\b|\bfrankfurt\b|\bcologne\b|\bstuttgart\b'),
    ('Spain', r'\bspain\b|\bmadrid\b|\bbarcelona\b'),
    ('Portugal', r'\bportugal\b|\blisbon\b|\bporto\b'),
    ('Italy', r'\bitaly\b|\bmilan\b|\brome\b'),
    ('Poland', r'\bpoland\b|\bwarsaw\b|\bkrak[oó]w\b|\bwroc[lł]aw\b'),
    ('Nordics', r'\bsweden\b|\bstockholm\b|\bdenmark\b|\bcopenhagen\b|\bnorway\b|\boslo\b|\bfinland\b|\bhelsinki\b'),
    ('Austria', r'\baustria\b|\bvienna\b|\bwien\b'),
    ('Belgium and Luxembourg', r'\bbelgium\b|\bbrussels\b|\bluxembourg\b'),
    ('Central and Eastern Europe', r'\bczech\b|\bprague\b|\bromania\b|\bbucharest\b|\bhungary\b|\bbudapest\b|\blithuania\b|\bvilnius\b|\bestonia\b|\btallinn\b|\bgreece\b|\bathens\b'),
)
PLACE_PATTERNS = tuple((label, fragment, re.compile(fragment, re.I)) for label, fragment in PLACE_OPTIONS)
MIN_PLACE_POSTINGS = 5   # a place is offered when at least this many matching postings sit there
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
        self.title_hits = self.elsewhere = 0   # role-keyword matches anywhere / those outside the wanted places
        self.places = {label: {'count': 0, 'examples': [], 'fragment': fragment} for label, fragment, _ in PLACE_PATTERNS}

    def feed(self):
        self.feeds += 1

    def add(self, title, in_place, matched, excluded=False, location=''):
        self.fetched += 1
        if matched and not excluded:
            self.title_hits += 1
            if not in_place:
                self._out_of_place(title, location)
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

    def _out_of_place(self, title, location):
        """A posting the role keywords caught in a place you did not list: counted under the first place option it sits in."""
        for label, _, pattern in PLACE_PATTERNS:
            if pattern.search(location or ''):
                entry = self.places[label]
                entry['count'] += 1
                if len(entry['examples']) < EXAMPLES and title not in entry['examples']:
                    entry['examples'].append(title)
                return
        self.elsewhere += 1

    def summary(self, now=None):
        suggestions = sorted(({'term': term, **entry} for term, entry in self.near.items() if entry['count'] >= 2),
                             key=lambda item: -item['count'])
        places = sorted(({'place': label, **entry} for label, entry in self.places.items() if entry['count'] >= MIN_PLACE_POSTINGS),
                        key=lambda item: -item['count'])
        return {'at': (now or datetime.now(timezone.utc)).isoformat(timespec='seconds'), 'feeds': self.feeds, 'fetched': self.fetched,
                'in_places': self.in_places, 'matched': self.matched, 'suggestions': suggestions,
                'title_hits': self.title_hits, 'places': places, 'elsewhere': self.elsewhere}


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


def verdict(summary, keywords=(), locations=()):
    """What to tell the user: {'narrow': bool, 'share': matched / in_places, 'suggestions': those not already keywords}.
    Narrow = the keywords catch under NARROW_BELOW of the in-place postings AND some listed term would add at least 5 more."""
    if not summary or not (summary.get('in_places') or summary.get('places')):
        return None
    have = {str(word).lower() for word in keywords}
    suggestions = [s for s in summary.get('suggestions', []) if s['term'].lower() not in have]
    share = summary['matched'] / summary['in_places'] if summary.get('in_places') else 1
    for item in suggestions:
        item['local'] = item['term'] in LOCAL_VOCAB
    local = any(item['local'] and item['count'] >= LOCAL_MIN for item in suggestions)
    return {'narrow': (share < NARROW_BELOW and any(s['count'] >= 5 for s in suggestions)) or local, 'local': local, 'share': share, 'matched': summary['matched'],
            'in_places': summary['in_places'], 'fetched': summary['fetched'], 'feeds': summary['feeds'], 'at': summary.get('at'),
            'suggestions': suggestions[:8], 'places': places_verdict(summary, locations)}


def places_verdict(summary, locations=()):
    """Where the role keywords find jobs just outside your places: {'title_hits', 'matched', 'options', 'elsewhere'} or None.
    Options are the offered places (fixed list) that hold at least MIN_PLACE_POSTINGS postings, minus fragments already in your places."""
    have = {str(fragment).lower() for fragment in locations}
    options = [o for o in summary.get('places') or [] if o.get('fragment', '').lower() not in have]
    if not options:
        return None
    return {'title_hits': summary.get('title_hits', 0), 'matched': summary['matched'], 'elsewhere': summary.get('elsewhere', 0),
            'options': [{'place': o['place'], 'count': o['count'], 'examples': o.get('examples', []), 'fragment': o['fragment']} for o in options[:8]]}
