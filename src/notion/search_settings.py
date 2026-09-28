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

Matching entries (roles, titles, skills, places, regions, discovery words) are whole words, case- and
accent-insensitive: "zürich" also matches "Zurich". An entry written /like this/ is a regular expression,
for the rare case plain words aren't enough.

    python -m src.notion.search_settings render   # the page as markdown, from the cached files (to create it)
    python -m src.notion.search_settings sync     # Notion page -> cached files (what __main__ runs)
"""
import json
import os
import re
import sys

from ..paths import CONFIG

PAGE_ID = os.getenv('NOTION_SEARCH_SETTINGS_PAGE', '')
TITLE = '⚙️ Search settings'
INTRO = ('What Job Pilotto looks for. Edit freely: one entry per bullet; the next search uses your changes. '
         'Words match whole words, any case, with or without accents. Write /…/ for a regular expression.')

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
    ('Job board searches', 'search', ('jobs_board_search_queries',), 'text'),
    ('Words that find new employers', 'search', ('board_discovery_keywords',), 'match'),
    ('Google Jobs searches', 'search', ('google_jobs', 'queries'), 'text'),
    ('Google Jobs places', 'search', ('google_jobs', 'locations'), 'place'),
]
ACCENTS = {'u': 'ü', 'o': 'ö', 'a': 'ä', 'e': 'é'}
META = set('\\^$.|?*+()[]{}')


def readable(fragment):
    """A regex fragment as a plain entry when it is just words ("\\bsre\\b" -> "sre", "z[uü]rich" -> "zürich"),
    else as /fragment/."""
    plain = fragment.replace('\\b', '')  # whole words are the default
    for base, accent in ACCENTS.items():
        plain = plain.replace(f'[{base}{accent}]', accent).replace(f'[{accent}{base}]', accent)
    return plain if not META & set(plain) else f'/{fragment}/'


def fragment(entry):
    """A plain entry as a whole-word, accent-insensitive regex fragment; /…/ entries as written."""
    entry = entry.strip()
    if len(entry) > 2 and entry.startswith('/') and entry.endswith('/'):
        return entry[1:-1]
    text = re.escape(entry)
    for base, accent in ACCENTS.items():
        text = text.replace(accent, f'[{base}{accent}]')
    start = r'\b' if re.match(r'\w', entry) else ''
    end = r'\b' if re.search(r'\w$', entry) else ''
    return f'{start}{text}{end}'


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


def render(files=None):
    """The page body as markdown (headings and bullets), from the cached settings."""
    files = files or load_cached()
    out = [INTRO, '']
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
            out += [f'- {readable(v) if kind == "match" else v}' for v in value]
        out.append('')
    return '\n'.join(out).strip() + '\n'


def parse(text):
    """Page text (as Tracker.page_text gives it: "## Heading" and "- entry" lines) -> {(file, path): value}."""
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
        if kind == 'number':
            numbers = [int(n) for n in re.findall(r'\d+', ' '.join(entries[:1]))]
            if numbers:
                values[(name, path)] = numbers[0]
        elif kind == 'place':
            places = []
            for entry in entries:
                location, _, language = entry.partition(' · ')
                places.append({'location': location.strip(), **({'language': language.strip()} if language.strip() else {})})
            values[(name, path)] = places
        elif kind == 'match':
            values[(name, path)] = [fragment(entry) for entry in entries]
        else:
            values[(name, path)] = entries
    return values


def apply(values, files=None):
    """Merge parsed values into the cached settings and write them; returns the files."""
    files = files or load_cached()
    for (name, path), value in values.items():
        _set(files[name], path, value)
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
    values = parse(tracker.page_text(page_id))
    if values:
        apply(values)
    return bool(values)


def sync_quietly():
    try:
        sync()
    except Exception as error:  # noqa: BLE001 — Notion down: the last cached settings are used
        print(f'Warning: search settings not read from Notion ({type(error).__name__}); using the last copy.')


def main(argv=None):
    command = (argv or sys.argv[1:] or ['render'])[0]
    if command == 'render':
        sys.stdout.write(render())
    elif command == 'sync':
        print('Search settings read from Notion.' if sync() else 'No Notion search settings page; nothing to read.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
