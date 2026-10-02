"""⚙️ Search settings: what Job Pilotto looks for, as a readable Notion page (the source of truth).

The page has one heading per setting and one bullet per entry, e.g.

    ## Roles to look for
    - site reliability
    - sre
    ## Companies to skip
    - Acme Corp

Before each crawl (`python -m src daily|discover|scout|feeds`) the page is read and written to
config/search.json and config/preferences.json, which are only a cache of it (the code reads those files).
A heading that's missing keeps the cached value; a heading with no bullets means "none".

Matching entries (roles, titles, skills, places, regions, discovery words) match anywhere in the text, any
case, with or without accents, exactly like the cached regex fragments: "entwickler" also matches
"Softwareentwickler", "zürich" also matches "Zurich". "In quotes" means a whole word only ("sre" does not
match "Srebrenica"). /Like this/ is a regular expression. Rendering and parsing are exact inverses, so the
page never changes what a search matches. Pages written before this format (no "Format 2" in the intro)
treated every plain entry as a whole word; they are still read that way until `upgrade` rewrites them.

    python -m src.notion.search_settings render   # the page as markdown, from the cached files (to create it)
    python -m src.notion.search_settings sync     # Notion page -> cached files (what __main__ runs)
    python -m src.notion.search_settings upgrade  # an older page -> this format (prints the new page, or nothing)
"""
import json
import os
import re
import sys

from ..paths import CONFIG

PAGE_ID = os.getenv('NOTION_SEARCH_SETTINGS_PAGE', '')
TITLE = '⚙️ Search settings'
FORMAT = 'Format 2'
INTRO = ('What Job Pilotto looks for. Edit freely: one entry per bullet; the next search uses your changes. '
         'A word matches anywhere, any case, with or without accents ("entwickler" also finds "Softwareentwickler"). '
         '"In quotes" = whole word only. /…/ = a regular expression. ' + FORMAT + '.')

# (heading, file, path in that file, kind): 'match' entries become regex fragments; 'text' are used as written;
# 'number' is one number; 'place' is "Location · language" for Google Jobs.
SECTIONS = [
    ('Roles to look for', 'search', ('role_keywords',), 'match'),
    ('Job titles to skip', 'search', ('title_exclude_keywords',), 'match'),
    ('Skills that make a job a better match', 'search', ('quality_stack_keywords',), 'match'),
    ('Best places', 'search', ('locations', 'top_tier'), 'match'),
    ('Anywhere in the country', 'search', ('locations', 'country_wide'), 'match'),
    ('Places abroad', 'search', ('locations', 'abroad'), 'match'),
    ('Remote jobs: regions to skip', 'search', ('remote_excluded_regions',), 'match'),
    ('Companies to skip', 'preferences', ('excluded_companies',), 'text'),
    ('Languages that rule a job out', 'preferences', ('disqualifying_languages',), 'text'),
    ('Minimum fit score for the digest', 'preferences', ('digest_min_score',), 'number'),
    ('Daily applications target', 'preferences', ('daily_applications_target',), 'number'),
    ('Job board searches', 'search', ('jobs_board_search_queries',), 'text'),
    ('Words that find new employers', 'search', ('board_discovery_keywords',), 'match'),
    ('Google Jobs searches', 'search', ('google_jobs', 'queries'), 'text'),
    ('Google Jobs places', 'search', ('google_jobs', 'locations'), 'place'),
]
ACCENTS = {'u': 'ü', 'o': 'ö', 'a': 'ä'}  # Swiss German umlauts: "zürich" also finds "Zurich"
META = set('\\^$.|?*+()[]{}')


def _accents_to_plain(text):
    for base, accent in ACCENTS.items():
        text = text.replace(f'[{base}{accent}]', accent).replace(f'[{accent}{base}]', accent)
    return text


def readable(fragment):
    """A regex fragment as the page shows it, exactly reversible by fragment():
    "site reliability" -> site reliability, "z[uü]rich" -> zürich, "\\bsre\\b" -> "sre", else /fragment/."""
    whole = re.fullmatch(r'\\b(.+)\\b', fragment)
    inner = _accents_to_plain(whole.group(1) if whole else fragment)
    if META & set(inner) or '"' in inner or inner != inner.strip() or not inner:
        return f'/{fragment}/'
    entry = f'"{inner}"' if whole else inner
    return entry if fragment_of(entry) == fragment else f'/{fragment}/'


def fragment_of(entry):
    """Page entry -> regex fragment: plain = anywhere; "quoted" = whole word; /…/ = as written."""
    entry = entry.strip()
    if len(entry) > 2 and entry.startswith('/') and entry.endswith('/'):
        return entry[1:-1]
    quoted = len(entry) > 2 and entry.startswith('"') and entry.endswith('"')
    text = ''.join('\\' + c if c in META else c for c in (entry[1:-1] if quoted else entry))
    for base, accent in ACCENTS.items():
        text = text.replace(accent, f'[{base}{accent}]')
    return rf'\b{text}\b' if quoted else text


def fragment_v1(entry):
    """How pages without "Format 2" were read: a plain entry was a whole word."""
    entry = entry.strip()
    if len(entry) > 2 and entry.startswith('/') and entry.endswith('/'):
        return entry[1:-1]
    text = re.escape(entry)
    for base, accent in ACCENTS.items():
        text = text.replace(accent, f'[{base}{accent}]')
    start = r'\b' if re.match(r'\w', entry) else ''
    end = r'\b' if re.search(r'\w$', entry) else ''
    return f'{start}{text}{end}'


fragment = fragment_of


def readable_v1(fragment):
    """How the first page format showed a fragment (every plain entry read as a whole word)."""
    plain = _accents_to_plain(fragment.replace('\\b', ''))
    return plain if not META & set(plain) else f'/{fragment}/'


def _get(data, path):
    for key in path:
        data = (data or {}).get(key)
    return data


def _set(data, path, value):
    for key in path[:-1]:
        data = data.setdefault(key, {})
    data[path[-1]] = value


def load_cached():
    read = lambda name: json.loads((CONFIG / f'{name}.json').read_text()) if (CONFIG / f'{name}.json').exists() else {}
    return {'search': read('search'), 'preferences': read('preferences')}


def render(files=None, show=None, intro=None):
    """The page body as markdown (headings and bullets), from the cached settings."""
    files = files or load_cached()
    show = show or readable
    out = [intro or INTRO, '']
    for heading, name, path, kind in SECTIONS:
        value = _get(files[name], path)
        if value is None:
            continue
        out.append(f'## {heading}')
        if kind == 'number':
            out.append(f'- {value}')
        elif kind == 'place':
            out += [f"- {p['location']} · {p.get('language', '')}".rstrip(' ·') for p in value]
        else:
            out += [f'- {show(v) if kind == "match" else v}' for v in value]
        out.append('')
    return '\n'.join(out).strip() + '\n'


def _unique(entries):
    """The entries once each (same text ignoring case and outer spaces), in page order."""
    seen, out = set(), []
    for entry in entries:
        key = ' '.join(str(entry).split()).lower()
        if key and key not in seen:
            seen.add(key)
            out.append(entry)
    return out


def parse(text, to_fragment=None):
    """Page text (as Tracker.page_text gives it: "## Heading" and "- entry" lines) -> {(file, path): value}.
    A page without "Format 2" is read with the older whole-word rule, so its meaning never changes silently."""
    to_fragment = to_fragment or (fragment_of if FORMAT in text else fragment_v1)
    by_heading = {heading.lower(): (name, path, kind) for heading, name, path, kind in SECTIONS}
    found, current = {}, None
    for line in text.splitlines():
        line = line.strip()
        heading = re.match(r'^#+\s*(.+)$', line)
        if heading:
            current = by_heading.get(heading.group(1).strip().lower())
            if current:
                found.setdefault(current, [])
            continue
        if current and line.startswith('- ') and line[2:].strip():
            found[current].append(line[2:].strip())
    values = {}
    for (name, path, kind), entries in found.items():
        entries = _unique(entries)   # a page that shows a section twice (two writers at once) must not double a list
        if kind == 'number':
            numbers = [int(n) for n in re.findall(r'\d+', ' '.join(entries[:1]))]
            if numbers:
                values[(name, path)] = numbers[0]
        elif kind == 'place':
            places = []
            for entry in entries:
                location, _, language = entry.partition(' · ')
                places.append({'location': location.strip(), **({'language': language.strip()} if language.strip() else {})})
            values[(name, path)] = [p for i, p in enumerate(places) if p not in places[:i]]
        elif kind == 'match':
            values[(name, path)] = _unique([to_fragment(entry) for entry in entries])
        else:
            values[(name, path)] = entries
    return values


def _is_tracked_example_dir():
    from ..paths import ROOT
    return (not os.getenv('JOB_PILOTTO_CONFIG_DIR') and not os.getenv('GITHUB_ACTIONS') and not os.getenv('JOB_PILOTTO_ALLOW_REPO_CONFIG')
            and 'unittest' not in sys.modules and CONFIG == ROOT / 'config')


def apply(values, files=None):
    """Merge parsed values into the cached settings and write them; returns the files."""
    files = files or load_cached()
    for (name, path), value in values.items():
        _set(files[name], path, value)
    if _is_tracked_example_dir():
        # A source checkout with no config folder of its own: config/ here is the example files the repo ships (public). The user's
        # real settings must never be written over them (1 Oct 2026: they were, then nearly committed). The desktop app and the
        # scheduled runs set their own folder, so they are not affected.
        print('Search settings: not written into the repo\'s example config/ (set JOB_PILOTTO_CONFIG_DIR to use your own).')
        return files
    CONFIG.mkdir(parents=True, exist_ok=True)
    for name in ('search', 'preferences'):
        (CONFIG / f'{name}.json').write_text(json.dumps(files[name], indent=2, ensure_ascii=False) + '\n')
    return files


def sync(tracker=None, page_id=PAGE_ID):
    """Notion page -> cached files. Without the page or Notion, the cache is used as it is."""
    if not page_id:
        return False
    if tracker is None:
        from .client import Tracker
        tracker = Tracker.from_env()
    if not tracker:
        return False
    text = tracker.page_text(page_id)
    if FORMAT not in text:  # first format: wait for `upgrade` (the app runs it) so no meaning changes silently
        print('Search settings: the Notion page is in the older format; using the last copy until the app updates it.')
        return False
    values = parse(text)
    if values:
        apply(values)
    return bool(values)


def upgrade(tracker=None, page_id=PAGE_ID):
    """A page in the first format -> the new page text (None when it's already current). Unedited (it still
    shows exactly what the cache holds): rebuilt from the cache, so every entry keeps its exact meaning.
    Edited: the edits are taken as they were read (whole words), written to the cache, then re-rendered."""
    if not page_id:
        return None
    if tracker is None:
        from .client import Tracker
        tracker = Tracker.from_env()
    text = tracker.page_text(page_id)
    if FORMAT in text:
        return None
    cached = load_cached()
    as_shown = parse(render(cached, show=readable_v1, intro='(first format)'), fragment_v1)
    on_page = parse(text, fragment_v1)
    if on_page != {key: value for key, value in as_shown.items() if key in on_page}:
        cached = apply(on_page, cached)
    return render(cached)


def sync_quietly():
    try:
        sync()
    except Exception as error:  # noqa: BLE001 — Notion down: the last cached settings are used
        print(f'Warning: search settings not read from Notion ({type(error).__name__}); using the last copy.')


def main(argv=None):
    command = (argv or sys.argv[1:] or ['render'])[0]
    if command == 'render':
        sys.stdout.write(render())
    elif command == 'upgrade':
        sys.stdout.write(upgrade() or '')
    elif command == 'sync':
        print('Search settings read from Notion.' if sync() else 'No Notion search settings page; nothing to read.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
