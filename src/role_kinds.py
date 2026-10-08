"""Kinds of role (software, retail, logistics, …): what an employer or a job board mostly hires for, and what a search looks for.

The central scout counts each feed's job titles by kind and publishes the shares (the employer index's `kinds`); the jobs check then skips
employers in the user's places that hire nothing of the user's kind (6 Oct 2026: a photographer's check read 190 employers in Geneva, nearly all
software companies, and matched 0 of 18,641 postings). Fixed words only: the same list is checked on the website (site/src/employers.js KINDS).
"""
import re

# Order matters for the seed: tech first, then each kind ("Retail data analyst" is software, "Store manager" retail).
KINDS = ('software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'other')
# Which kind a title or a role word is, in any language: the meanings pack (the old word lists of this file and coverage.py as seed, plus what
# the site learned) and, for any other wording, the AI (src/ai/decide.py); 'other' when neither knows, as an unmatched title was before.
TASK = ('A job title, or a role a job seeker looks for, in any language. Answer its kind of work: software = software, IT, data, devops, '
        'security engineering; sales_b2b = selling to companies, account management, business development; sales_retail = shop and store '
        'sales; logistics = warehouse, driving, delivery, supply chain; hospitality = kitchen, restaurant, hotel, bar; healthcare = nursing, '
        'medical, pharmacy, care; creative_media = photo, video, design, content, journalism; finance_admin = accounting, finance, office, HR, '
        'admin; education = teaching, training, childcare; trades = technicians, mechanics, electricians, construction; other = anything else.')


def kinds_of(texts, topic='role-kind'):
    """{text: kind} for these titles or role words, asked together; 'other' for what nothing knows. job-title-kind: titles from public
    postings (the site may learn them); role-kind: the user's own words (they never leave the machine)."""
    from .ai import decide
    texts = list(dict.fromkeys(str(t or '').strip() for t in texts if str(t or '').strip()))
    found = decide.decide(topic, {t.lower(): t for t in texts}, KINDS, TASK) or {}
    return {t: found.get(t.lower(), 'other') for t in texts}


MIN_TITLES = 5        # fewer titles say little about an employer: no mix published
MIN_SHARE = 0.05      # smaller shares are noise and left out of the mix


def kind_of(text, topic='role-kind'):
    """The kind of one job title or search phrase, or 'other'."""
    return kinds_of([text], topic).get(str(text or '').strip(), 'other')


def mix(titles):
    """{kind: share} of a feed's job titles (shares of MIN_SHARE or more, two decimals), or None with fewer than MIN_TITLES titles."""
    titles = [t for t in titles if t]
    if len(titles) < MIN_TITLES:
        return None
    counts, kinds = {}, kinds_of(titles, 'job-title-kind')
    for title in titles:
        kind = kinds.get(str(title).strip(), 'other')
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
    kinds = set(kinds_of(words).values()) - {'other'}
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
