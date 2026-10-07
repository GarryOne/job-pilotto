"""Kinds of role (software, retail, logistics, …): what an employer or a job board mostly hires for, and what a search looks for.

The central scout counts each feed's job titles by kind and publishes the shares (the employer index's `kinds`); the jobs check then skips
employers in the user's places that hire nothing of the user's kind (6 Oct 2026: a photographer's check read 190 employers in Geneva, nearly all
software companies, and matched 0 of 18,641 postings). Fixed words only: the same list is checked on the website (site/src/employers.js KINDS).
"""
import re

from .coverage import _TECH_STEMS, _TECH_WORDS

# Order matters: the first kind whose words a title has is its kind ("Retail data analyst" is software, "Store manager" retail).
KINDS = ('software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'other')
_WORDS = {
    # Selling to companies, apart from selling in a shop (7 Oct 2026: Datadog's account executives made it 43% "retail", so tech companies
    # passed a store seller's employer filter). Before sales_retail: "Sales Manager" is B2B, "Sales Associate" a shop.
    'sales_b2b': r'account (manager|executive|director|lead)|business develop|bizdev|customer success|sales (engineer|manager|director|development|representative|executive|operations|ops|lead|enablement)|\bsdr\b|\bbdr\b|partnership|solutions? (engineer|consultant|architect)|pre-?sales|key account|inside sales|field sales|enterprise sales|revenue (operations|manager)|commercial (manager|director|lead)',
    'sales_retail': r'sales|vente|vendeu[rs]e?|verk[aä]uf|retail|store|shop|boutique|client advis|sales advis|magasin(?!ier)|filial|g[eé]rante?|detailhandel|cashier|caissi|kassier|merchandis|commercial|conseill[eè]re? de vente|customer service|service client',
    'logistics': r'logisti|warehouse|entrep[oô]t|lager|magasinier|picker|pr[eé]parateur|driver|chauffeur|fahrer|courier|livreu|supply chain|shipping|forklift|cariste|dispatch|stock',
    'hospitality': r'chef|cook|cuisin|koch|waiter|serveu|kellner|barista|bartender|hotel|h[oô]tel|reception|housekeep|restaurant|kitchen|catering|gastro',
    'healthcare': r'nurse|infirmi|pflege|doctor|m[eé]decin|arzt|pharmac|therap|care assistant|aide.soignant|medical|m[eé]dical|clinic|dental|midwife|hebamme|caregiver',
    'creative_media': r'photograph|fotograf|video|film|camera|designer|graphi|illustrat|art director|creative|cr[eé]ati|content|copywriter|journalist|editor|r[eé]dacteur|retouch|social media|marketing|brand',
    'finance_admin': r'account(ant|ing)|comptab|buchhalt|finance|financ|controller|audit|tax|payroll|admin|assistant|secr[eé]tar|office|hr |human resources|ressources humaines|recruit|legal|juriste|lawyer|compliance|procurement|achat',
    'education': r'teacher|enseignant|lehrer|tutor|professor|lecturer|educat|[eé]ducat|trainer|formateur|school|[eé]cole',
    'trades': r'technician|technicien|techniker|mechanic|m[eé]canicien|electrician|[eé]lectricien|elektriker|plumber|welder|carpenter|menuisier|construction|b[aâ]timent|operator|op[eé]rateur|maintenance|installer|machinist|assembl',
}
_PATTERNS = {kind: re.compile(rf'(?<![a-z])({words})', re.I) for kind, words in _WORDS.items()}
MIN_TITLES = 5        # fewer titles say little about an employer: no mix published
MIN_SHARE = 0.05      # smaller shares are noise and left out of the mix


def kind_of(text):
    """The kind of one job title or search phrase, or 'other'."""
    text = str(text or '')
    if _TECH_WORDS.search(text) or any(stem in text.lower() for stem in _TECH_STEMS):
        return 'software'
    return next((kind for kind, pattern in _PATTERNS.items() if pattern.search(text)), 'other')


def mix(titles):
    """{kind: share} of a feed's job titles (shares of MIN_SHARE or more, two decimals), or None with fewer than MIN_TITLES titles."""
    titles = [t for t in titles if t]
    if len(titles) < MIN_TITLES:
        return None
    counts = {}
    for title in titles:
        kind = kind_of(title)
        counts[kind] = counts.get(kind, 0) + 1
    return {kind: round(n / len(titles), 2) for kind, n in sorted(counts.items(), key=lambda kv: -kv[1]) if n / len(titles) >= MIN_SHARE}


def valid(kinds):
    """A published mix as the engine keeps it: known kinds, shares between 0 and 1; None when it is not one."""
    if not isinstance(kinds, dict):
        return None
    clean = {k: float(v) for k, v in kinds.items() if k in KINDS and isinstance(v, (int, float)) and 0 <= v <= 1}
    return clean or None


def of_search(search):
    """The kinds a search looks for (from its role keywords), or None when it is not known yet (no keywords): then nothing is skipped."""
    # Regex fragments read as their words ("photograph(e|er)?" -> "photograph e er"), as coverage.looks_technical does: none is dropped.
    # "vendeu(r|se)" -> "vendeur": a group's first choice joined to the word; then the remaining regex marks as spaces.
    first = lambda word: re.sub(r'\(([^()|]*)\|[^()]*\)\??', r'\1', str(word))
    words = [re.sub(r'\\[bwsd]|[\\^$()|?*+\[\]{}.]', ' ', first(word)) for word in (search or {}).get('role_keywords') or []][:30]
    if not words:
        return None
    kinds = {kind_of(word) for word in words} - {'other'}
    return kinds or None   # only words we cannot place: as unknown


MIN_FIT = 0.15        # the wanted kinds' share of an employer's jobs below which it is not read (any share passed before 7 Oct 2026)
TECH_HEAVY = 0.3      # a software share from which an employer counts as a tech company, for a search that wants no software


def fits(feed_kinds, wanted):
    """Whether an employer with this mix hires for the wanted kinds: at least MIN_FIT of its jobs (7 Oct 2026: 7% "creative" kept a tech
    startup for a photographer), and for a search with no software, not a company whose software jobs outnumber the wanted ones. Unknown on
    either side keeps it, and so does a feed whose titles are mostly ones we cannot place (a language or trade the word lists miss), unless
    it also hires software people: skipping is for a clear mismatch."""
    feed_kinds = valid(feed_kinds)
    if not feed_kinds or not wanted:
        return True
    share, tech = sum(feed_kinds.get(kind, 0) for kind in wanted), feed_kinds.get('software', 0)
    if 'software' not in wanted and tech >= TECH_HEAVY and share < tech:
        return False
    if share >= MIN_FIT:
        return True
    return feed_kinds.get('other', 0) >= 0.5 and tech < 0.1
