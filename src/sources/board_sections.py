"""A job board's own section for the user's kind of work, opened when its home or search page gave no relevant job (owner, 24 Oct 2026: a
Moldovan board's home page was news, its IT section listed 100 jobs in the city; Moldova's search found 5 local jobs). The section is picked by the AI
from the page's own links (meaning in any language and any kind of work, src/ai/decide.py), never a word list: each link is a 'section' for this role,
a 'hub' (all jobs, all categories: one more hop) or 'other'. Sections are read like any listing page (JobPosting data, else the AI page reader, which
leaves a recipe), at most MAX_SECTIONS per board, through the site's robots.txt. Tests: tests/test_board_sections.py."""
import urllib.parse

from . import board_pages, careers, careers_parse

MAX_SECTIONS = 2      # section pages read per board
MAX_HUBS = 1          # hub pages opened per board (a link to "all categories", then the sections on it)
MAX_LINKS = 80        # links of one page sent to the AI
MAX_LABEL = 70        # a longer link text is a sentence, not a section name
ANSWERS = ('section', 'hub', 'other')
TOPIC = 'board section'
TASK = ('The user searches for jobs as "{role}". Each item is a link on a job board: its text and its address path. Answer "section" if it opens the '
        "board's jobs for that kind of work (the category or field a person in that role would browse, whatever the language), \"hub\" if it opens the "
        'board\'s list of all jobs or of all categories/fields, else "other" (news, employers, CV tools, log in, one job, a city only, a language).')


def candidates(markup, page_url):
    """[(address, text)] links of this page on the board's own site, one per path, with a short text, not the page itself."""
    host = careers_parse.registrable(urllib.parse.urlsplit(page_url).hostname or '')
    here = urllib.parse.urlsplit(page_url).path.rstrip('/')
    out, seen = [], set()
    for url, text in careers_parse.links(str(markup or ''), page_url):
        parts = urllib.parse.urlsplit(url)
        key = parts.path.rstrip('/')
        if (parts.scheme not in ('http', 'https') or careers_parse.registrable(parts.hostname or '') != host or key in seen or key == here
                or not text or len(text) > MAX_LABEL or key in ('', '/')):
            continue
        seen.add(key)
        out.append((url.split('#')[0], text))
    return out[:MAX_LINKS]


def pick(markup, page_url, role, decide):
    """([section addresses], [hub addresses]) the AI picked among the page's links; ([], []) with no AI answer (decide returns None)."""
    found = candidates(markup, page_url)
    if not found or not role:
        return [], []
    items = {f'{role}|{text}|{urllib.parse.urlsplit(url).path}': f'Link text: {text}\nPath: {urllib.parse.urlsplit(url).path}' for url, text in found}
    answers = decide(TOPIC, items, ANSWERS, TASK.format(role=role)) or {}
    chosen = {key: answers.get(key) for key in items}
    pairs = [(url, chosen[f'{role}|{text}|{urllib.parse.urlsplit(url).path}']) for url, text in found]
    return [url for url, answer in pairs if answer == 'section'][:MAX_SECTIONS], [url for url, answer in pairs if answer == 'hub'][:MAX_HUBS]


def read(page, address, role, fetch, decide, relevant):
    """(jobs, section address) from the board's sections reachable from this page (its markup, fetched at address): its own sections, else the
    sections on one hub page. relevant(jobs) -> the jobs worth keeping; the first section giving some is returned with them (all its jobs)."""
    sections, hubs = pick(page, address, role, decide)
    for hub in hubs if not sections else []:
        hub_page = _page(hub, fetch)
        if hub_page:
            sections, _ = pick(hub_page, hub, role, decide)
    for url in sections:
        listing = _page(url, fetch)
        if not listing:
            continue
        found = careers.jsonld_jobs(listing, url) or careers._asked(url, listing, [], fetch) or careers.read_page_from(listing, url, fetch)
        if found:
            found = found + board_pages.more(url, listing, found, fetch, lambda markup, link: careers.jsonld_jobs(markup, link) or careers.read_page_from(
                markup, link, fetch), relevant)
        if found and relevant(found):
            return found, url
    return [], None


def _page(url, fetch):
    if not board_pages.allowed(url, fetch):
        return ''
    try:
        return str(fetch(url) or '')
    except Exception:  # noqa: BLE001 — a section that does not answer: the next one
        return ''
