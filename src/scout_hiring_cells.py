"""Source scout, who hires, the central scout's questions: for the thinnest kind × country cell, six searches of a role family in a city of
that country (owner, 21 Oct 2026: "Lab role families × cities, 6 searches per run"), taken from the Lab's own draws (tools/persona-search/draws.json),
so there is no second list. A country with no city there is asked country-wide. Measured on the plan first: 20 such cells gave 33 employers, 12 with a
readable job site, and 65 local job portals.
Tests: tests/test_scout_hiring.py."""
import json
from pathlib import Path

from .pool_tags import COUNTRIES

PER_RUN = 6
DRAWS = Path(__file__).resolve().parents[1] / 'tools' / 'persona-search' / 'draws.json'
# Which Lab role families are a kind's work (fixed words; a kind with none is asked by its own work words, country-wide).
FAMILIES = {'healthcare': ('nurse', 'pharmacist'), 'hospitality': ('chef', 'hotel'), 'logistics': ('driver', 'warehouse'), 'education': ('teacher',),
            'trades': ('welder', 'electrician', 'carpenter', 'mechanic'), 'sales_retail': ('sales',), 'sales_b2b': ('sales',),
            'finance_admin': ('accountant', 'hr'), 'creative_media': ('designer', 'marketing')}


def draws():
    """The Lab's {'families': [...], 'cities': [...]}; empty when the file is not there."""
    try:
        return json.loads(DRAWS.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'families': [], 'cities': []}


def pairs(kind, country):
    """[(role title, place)] of this cell: each of the kind's families in each city of the country, 'City, Country'; [] when it has no family or city."""
    data = draws()
    titles = [family['title'] for family_id in FAMILIES.get(kind, ()) for family in data.get('families', []) if family.get('id') == family_id]
    name = COUNTRIES.get(country, '')
    cities = [item['city'] for item in data.get('cities', []) if item.get('country') == name]
    return [(title, f'{city}, {name}') for city in cities for title in titles]


def take(db, kind, country, fallback):
    """The next PER_RUN questions (role, place) for this cell, moving on each run (remembered in scout_meta); `fallback` (the country-wide
    question) when the cell has no role family or city."""
    found = pairs(kind, country)
    if not found:
        return [fallback]
    db.execute('CREATE TABLE IF NOT EXISTS scout_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    key = f'hiring_pairs|{kind}|{country}'
    row = db.execute('SELECT value FROM scout_meta WHERE key = ?', (key,)).fetchone()
    start = int(row[0]) if row and str(row[0]).isdigit() else 0
    db.execute('INSERT OR REPLACE INTO scout_meta (key, value) VALUES (?, ?)', (key, str((start + PER_RUN) % len(found))))
    return [found[(start + step) % len(found)] for step in range(min(PER_RUN, len(found)))]
