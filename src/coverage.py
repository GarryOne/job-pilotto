"""How much of the market does the search catch? The funnel of one crawl, and the near misses.

A crawl fetches every posting of every feed, keeps those with a wanted title in a wanted place, and drops the rest without a word.
When the role keywords are narrow that silently hides most of the relevant market (owner, 2 Oct 2026: 3,142 postings in his places,
164 matched, "distributed systems", his top interest, was not a keyword). This counts, per crawl: postings fetched, in the wanted
places, matched by the role keywords; and, among the in-place postings no keyword matched, how many titles contain each of a list of
engineering role terms, with examples, so the app can say "your keywords catch 5%; adding backend would add 49" and let the user choose.
No AI and no network: it only counts what the crawl already fetched.
"""
import json
import os
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
# Role words of other trades, in the languages of the places users search (6 Oct 2026: a photographer's search caught 0 of 6,449 postings
# in Geneva and the card, knowing only IT words, said nothing). Offered only to a search of that kind (role_kinds), fixed like the above.
TRADE_VOCAB = ('sales associate', 'sales advisor', 'client advisor', 'client adviser', 'store manager', 'shop manager', 'retail', 'cashier',
               'conseiller de vente', 'conseillère de vente', 'vendeur', 'vendeuse', 'gestionnaire de vente', 'employé de magasin', 'caissier',
               'caissière', 'gérant', 'gérante', 'responsable de magasin', 'verkäufer', 'verkäuferin', 'filialleiter', 'detailhandel',
               'warehouse', 'logistics', 'magasinier', 'logisticien', 'préparateur', 'cariste', 'chauffeur', 'livreur', 'lagerist', 'logistiker',
               'photographer', 'photographe', 'fotograf', 'videographer', 'vidéaste', 'retoucheur', 'graphic designer', 'graphiste',
               'content creator', 'social media', 'waiter', 'serveur', 'serveuse', 'barista', 'cuisinier', 'koch', 'réceptionniste',
               'nurse', 'infirmier', 'infirmière', 'pflegefachfrau', 'pflegefachmann', 'assistant en soins', 'accountant', 'comptable',
               'buchhalter', 'office assistant', 'assistant administratif', 'sachbearbeiter', 'teacher', 'enseignant', 'lehrer',
               'technician', 'technicien', 'électricien', 'mécanicien', 'elektriker', 'polymechaniker')
VOCAB = VOCAB + LOCAL_VOCAB + TRADE_VOCAB
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
        self.dropped = {}   # excluded-title word -> postings in the places that the role keywords caught and that word dropped

    def feed(self):
        self.feeds += 1

    def add(self, title, in_place, matched, excluded=False, location='', dropped_by=''):
        self.fetched += 1
        if dropped_by and in_place:
            entry = self.dropped.setdefault(dropped_by, {'count': 0, 'examples': []})
            entry['count'] += 1
            if len(entry['examples']) < EXAMPLES and title not in entry['examples']:
                entry['examples'].append(title)
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
        return {'excluded': sorted(({'fragment': f, **e} for f, e in self.dropped.items()), key=lambda item: -item['count'])[:8], 'at': (now or datetime.now(timezone.utc)).isoformat(timespec='seconds'), 'feeds': self.feeds, 'fetched': self.fetched,
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


# Words that mark a role keyword as IT/engineering work. VOCAB only knows engineering roles, so it is offered to searches that look technical.
_TECH_WORDS = re.compile(
    r'(?<![a-z])(software|developer|devops|sre|site reliability|cloud|backend|back-end|frontend|front-end|full.?stack|data|analytics|machine learning|'
    r'ml|infrastructure|platform|sysadmin|sysop|systems?|syst[eè]mes?|programmer|sdet|qa|security|network|database|kubernetes|it|entwickler|informatiker|'
    r'd[eé]veloppeur|sviluppatore|desarrollador|ontwikkelaar|programista|sistemista)(?![a-z])', re.I)
# Compound words (German "Softwareentwickler", "Systemadministrator") have no word boundary to match on: these stems count anywhere.
_TECH_STEMS = ('software', 'entwickler', 'informatik', 'devops', 'kubernetes', 'programmier', 'sysadmin', 'systemadmin')


def looks_technical(keywords):
    """True when any role keyword names IT/engineering work (regex fragments like "\\bsre\\b" are read as their words).
    An empty list is unknown, not non-technical."""
    words = [re.sub(r'\\[bwsd]|[\\^$()|?*+\[\]{}.]', ' ', str(word)) for word in keywords]
    return not words or any(_TECH_WORDS.search(word) or any(stem in word.lower() for stem in _TECH_STEMS) for word in words)


def technical_search(search):
    """True when a search's roles are IT or engineering work (or not known yet): the developer-only sources (SwissDevJobs, TechTree, the
    tech seed lists) are for it. One definition for the scout and the job boards (6 Oct 2026: a photographer's checks crawled both boards)."""
    from .role_kinds import of_search   # the kinds of role a search looks for: one classifier for scout, boards and employers
    kinds = of_search(search)
    return kinds is None or 'software' in kinds


def verdict(summary, keywords=(), locations=(), excludes=None):
    """What to tell the user: {'narrow': bool, 'share': matched / in_places, 'suggestions': those not already keywords}.
    Narrow = the keywords catch under NARROW_BELOW of the in-place postings AND some listed term would add at least 5 more.
    A search with no technical keyword (a nurse, an accountant) gets no engineering suggestions and no "too narrow" warning."""
    if not summary or not (summary.get('in_places') or summary.get('places')):
        return None
    have = {str(word).lower() for word in keywords}
    from .role_kinds import kind_of, of_search
    wanted = of_search({'role_keywords': list(keywords)})
    # The words of the search's own kinds of role only: an IT search gets IT words, a shop search shop words (6 Oct 2026: nothing for others).
    suggestions = [s for s in summary.get('suggestions', []) if s['term'].lower() not in have
                   and (s['term'] not in TRADE_VOCAB if not wanted or 'software' in wanted else kind_of(s['term']) in wanted)]
    share = summary['matched'] / summary['in_places'] if summary.get('in_places') else 1
    for item in suggestions:
        item['local'] = item['term'] in LOCAL_VOCAB
    local = any(item['local'] and item['count'] >= LOCAL_MIN for item in suggestions)
    return {'narrow': (share < NARROW_BELOW and any(s['count'] >= 5 for s in suggestions)) or local, 'local': local, 'share': share, 'matched': summary['matched'],
            'in_places': summary['in_places'], 'fetched': summary['fetched'], 'feeds': summary['feeds'], 'at': summary.get('at'),
            'suggestions': suggestions[:8], 'places': places_verdict(summary, locations), 'sources': unused_sources(),
            'excluded': [item for item in summary.get('excluded') or [] if item['fragment'] in set(excludes or ()) and item['count'] >= 2]}


# Ways to get more jobs this install does not use yet, least effort first. Fixed list: what each costs is said, nothing is turned on here
# (owner, 6 Oct 2026: "recommend all the unused options, ordered by the lowest effort; keys, costs or the user's browser as an option").
SOURCES = (
    {'id': 'brave', 'name': 'Web search (Brave)', 'effort': 'A free key, about 2 minutes', 'gain': "finds employers' own job sites when their name leads nowhere",
     'unused': lambda env: not env.get('BRAVE_SEARCH_API_KEY') and not _claude_code(env)},
    {'id': 'aggregators', 'name': 'Adzuna and Jooble', 'effort': 'Two free keys, about 3 minutes', 'gain': 'job search engines across all trades and countries',
     'unused': lambda env: not ((env.get('ADZUNA_APP_ID') and env.get('ADZUNA_APP_KEY')) or env.get('JOOBLE_API_KEY'))},
    {'id': 'serpapi', 'name': 'Google Jobs (SerpApi)', 'effort': 'A free key (250 searches a month); paid plans beyond', 'gain': 'jobs Google has collected from every site, LinkedIn included',
     'unused': lambda env: not env.get('SERPAPI_API_KEY')},
)


def _claude_code(env):
    return (env.get('JOB_PILOTTO_AI_ENGINE') or '').lower() == 'cli'


def unused_sources(env=None):
    """[{id, name, effort, gain}] of SOURCES this install does not use, in order (least effort first)."""
    env = os.environ if env is None else env
    return [{key: source[key] for key in ('id', 'name', 'effort', 'gain')} for source in SOURCES if source['unused'](env)]


def language_drops(db=None):
    """[{language, count, examples}]: open jobs in the cache that a language in the user's "languages that rule a job out" hides (the
    AI read it as required), most first. 6 Oct 2026: a photographer's preferences ruled out English, German, Italian and Spanish."""
    from . import digest, store
    from .paths import JOBS_DB
    try:
        db = db or store.connect(JOBS_DB)
        _, hidden = digest.eligible_jobs(db)
    except Exception:  # noqa: BLE001 — no cache yet: nothing to say
        return []
    ruled_out = set(digest.PREFERENCES.get('disqualifying_languages') or [])
    counts = {}
    for job in hidden:
        for item in (job.get('ai') or {}).get('languages') or []:
            if item.get('level') == 'required' and item.get('language') in ruled_out:
                entry = counts.setdefault(item['language'], {'language': item['language'], 'count': 0, 'examples': []})
                entry['count'] += 1
                if len(entry['examples']) < EXAMPLES:
                    entry['examples'].append(str(job.get('title') or '')[:80])
    return sorted(counts.values(), key=lambda item: -item['count'])


def places_verdict(summary, locations=()):
    """Where the role keywords find jobs just outside your places: {'title_hits', 'matched', 'options', 'elsewhere'} or None.
    Options are the offered places (fixed list) that hold at least MIN_PLACE_POSTINGS postings, minus fragments already in your places."""
    have = {str(fragment).lower() for fragment in locations}
    options = [o for o in summary.get('places') or [] if o.get('fragment', '').lower() not in have]
    if not options:
        return None
    return {'title_hits': summary.get('title_hits', 0), 'matched': summary['matched'], 'elsewhere': summary.get('elsewhere', 0),
            'options': [{'place': o['place'], 'count': o['count'], 'examples': o.get('examples', []), 'fragment': o['fragment']} for o in options[:8]]}
