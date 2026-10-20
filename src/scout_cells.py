"""Source scout, thin cells: the central list's employers per kind of role × European country (what /admin/scouting draws), kept after each
publish, and the thin cell the central scout's AI ideas aim at next (owner, 19 Oct 2026: "Scout where the list is thin"; the ideas had been
asked for the example search's data-analyst roles and answered "scale-ups and SaaS or fintech engineering hubs").
Tests: tests/test_scout_cells.py.
"""
import json
from collections import Counter

from . import role_kinds
from .pool_tags import COUNTRIES, EUROPE

FLOOR = 25      # employers per kind and country the scout aims for (site/src/scoutingadmin.js FLOOR)
AIMED = tuple(kind for kind in role_kinds.KINDS if kind not in ('software', 'other'))   # every kind but the strong one and the leftover
RECENT = 40     # cells aimed at lately wait their turn, so one empty cell does not take every run


def top_kind(feed):
    """What an employer mostly hires for (its largest share), as the site's topKind: 'unknown' without a mix."""
    kinds = role_kinds.valid(feed.get('kinds')) or {}
    return max(kinds, key=kinds.get) if kinds else 'unknown'


def count(feeds):
    """{'<kind>|<country>': employers} over the European countries, from the feeds just verified."""
    return dict(Counter(f'{top_kind(feed)}|{country}' for feed in feeds for country in feed.get('countries') or [] if country in EUROPE))


def _meta(db, key, default):
    db.execute('CREATE TABLE IF NOT EXISTS scout_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    row = db.execute('SELECT value FROM scout_meta WHERE key = ?', (key,)).fetchone()
    try:
        return json.loads(row[0]) if row else default
    except ValueError:
        return default


def _set(db, key, value):
    db.execute('CREATE TABLE IF NOT EXISTS scout_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('INSERT OR REPLACE INTO scout_meta (key, value) VALUES (?, ?)', (key, json.dumps(value)))


def keep(db, feeds):
    """Remember the counts of this publish: the next run's ideas aim by them."""
    _set(db, 'cells', count(feeds))
    db.commit()


def next_cell(db):
    """(kind, country id) the next ideas aim at: the thinnest cell under FLOOR not aimed at lately, or None (no counts yet, or none thin)."""
    cells, recent = _meta(db, 'cells', None), _meta(db, 'cells_aimed', [])
    if not isinstance(cells, dict):
        return None
    thin = sorted((cells.get(f'{kind}|{country}', 0), AIMED.index(kind), EUROPE.index(country), kind, country)
                  for kind in AIMED for country in EUROPE if cells.get(f'{kind}|{country}', 0) < FLOOR and f'{kind}|{country}' not in recent)
    if not thin:
        _set(db, 'cells_aimed', [])   # every thin cell had its turn: start again
        db.commit()
        return None
    kind, country = thin[0][3], thin[0][4]
    _set(db, 'cells_aimed', (recent + [f'{kind}|{country}'])[-RECENT:])
    return kind, country


def search_for(kind, country):
    """A search for this cell, in the shape the ideas read (roles and places in plain words): the kind's work, the whole country."""
    return {'role_keywords': [word.strip() for word in role_kinds.WORK[kind].split(',')],
            'locations': {'top_tier': [], 'country_wide': [COUNTRIES[country]], 'abroad': []}}


def aim(db, search):
    """(search, label) for the central scout's ideas: the next thin cell's search and its kind, remembered for /admin/scouting
    ('ideas_cell'); the given search and '' when no cell is thin or counted yet."""
    cell = next_cell(db)
    if not cell:
        return search, ''
    db.execute('INSERT OR REPLACE INTO scout_meta (key, value) VALUES (?, ?)', ('ideas_cell', f'{cell[0]}|{cell[1]}'))   # plain text, as ideas_at
    db.commit()   # before the AI call: its cache writes through another connection, and an open write here locked it (20 Oct 2026)
    print(f'Scout ideas: aimed at {cell[0]} in {COUNTRIES[cell[1]]}, one of the thinnest cells of the central list.')
    return search_for(*cell), cell[0]
