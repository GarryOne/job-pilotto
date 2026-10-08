"""The level a person is looking for ("junior", "mid", "senior", "lead") as title words to skip, before any AI is spent on a posting.

The crawl matches titles on the roles the user wants, and a title rarely says "mid": "Data Analyst" can be anyone's job. So a level never
*requires* a word (that would drop every unlabelled posting); it skips the titles that plainly name another level. Fixed words, several
languages. An unknown level is ignored, never an error: the search then behaves as it did before levels existed.
"""
import re

# Titles that plainly name a senior or entry-level role: rows of the meanings pack (topic title-level; the seed is the list this file had,
# English, German, French, Italian), so the site can add other languages. A free first row: AI scoring judges every title it lets through.
def _named(answer):
    from .ai import meanings_pack
    return tuple(meanings_pack.patterns('title-level', answer))


SENIOR, ENTRY = 'senior', 'entry'

LEVELS = {
    'junior': {'words': ('junior', 'entry', 'entry level', 'graduate', 'beginner', 'einsteiger', 'debutant'), 'skips': (SENIOR,)},
    'mid': {'words': ('mid', 'mid level', 'medior', 'intermediate', 'middle'), 'skips': (SENIOR, ENTRY)},
    'senior': {'words': ('senior', 'experienced', 'erfahren'), 'skips': (ENTRY,)},
    'lead': {'words': ('lead', 'staff', 'principal', 'staff principal', 'staff/principal', 'manager', 'head'), 'skips': (ENTRY,)},
}
_BY_WORD = {word: name for name, level in LEVELS.items() for word in (name, *level['words'])}


def level_of(setting):
    """The level a settings value names (a word, or a list whose first word counts), or None."""
    first = (setting[0] if isinstance(setting, (list, tuple)) and setting else setting) if setting else ''
    text = re.sub(r'\s+', ' ', re.sub(r'[\s_-]+', ' ', str(first).lower().replace('\\b', ''))).strip()
    return _BY_WORD.get(text)


def title_skips(setting):
    """The title fragments to add to the skipped titles for this level setting, or []."""
    name = level_of(setting)
    return [pattern for skip in LEVELS[name]['skips'] for pattern in _named(skip)] if name else []
