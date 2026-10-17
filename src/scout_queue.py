"""Source scout, the queue's order: which waiting names are checked first, and which stop waiting. Each source (the origin without its date or
batch tag: "AI idea", "Wikidata", "hiring-without-whiteboards") is ranked by its measured yield on this install, the share of its checked names that
had a readable job feed, with a fair start for a source never checked ((found + 1) / (checked + 2)). A name the user or a Tier 1 seed put first
(priority PINNED and up) stays first. A source with no feed after EXPIRE_AFTER checks stops waiting (status 'expired', never probed, never deleted).
Owner, 18 Oct 2026: replaces the 100-name pause, which froze every new name for 12 days while 514 names of a list with no feed waited.
Tests: tests/test_scout_queue.py.
"""
from collections import Counter

PINNED = 95            # a pasted page (96) and Tier 1 seeds (95, 100) go first whatever their source's yield
EXPIRE_AFTER = 20      # checks of one source with no feed at all before its waiting names stop waiting
CHECKED = ('found', 'low', 'none', 'watch')


def kind_of(origin):
    from .ai.scout_ideas import origin_kind
    return origin_kind(origin)


def counts(db):
    """{source: (checked, found)} from the queue itself."""
    checked, found = Counter(), Counter()
    for row in db.execute('SELECT origin, status, COUNT(*) n FROM scout_candidates GROUP BY origin, status'):
        kind = kind_of(row['origin'])
        if row['status'] in CHECKED:
            checked[kind] += row['n']
        if row['status'] == 'found':
            found[kind] += row['n']
    return {kind: (checked[kind], found[kind]) for kind in set(checked) | set(found)}


def yields(db):
    """{source: share of its checked names with a feed}, a never-checked source at 0.5 (`share` gives it for any name)."""
    return {kind: (found + 1) / (checked + 2) for kind, (checked, found) in counts(db).items()}


def share(shares, origin):
    return shares.get(kind_of(origin), 0.5)


def ordered(rows, shares, readers):
    """Names never checked first: pinned ones, then by their source's yield, priority, age. Then re-checks: those judged by older readers, then by date."""
    def key(row):
        recheck = row['status'] in ('low', 'none', 'watch')
        if recheck:
            return (1, (row.get('checked_with') or '') == readers, 0, -(row['priority'] or 0), row['added_at'] or '')
        return (0, 0 if (row['priority'] or 0) >= PINNED else 1, -share(shares, row['origin']), -(row['priority'] or 0), row['added_at'] or '')
    return sorted(rows, key=key)


def expire(db):
    """Stop the waiting names of every source that had no feed in EXPIRE_AFTER or more checks; pinned names stay. Returns {source: names}."""
    dead = {kind for kind, (checked, found) in counts(db).items() if checked >= EXPIRE_AFTER and not found}
    if not dead:
        return {}
    out = Counter()
    for row in db.execute("SELECT key, origin FROM scout_candidates WHERE status = 'pending' AND priority < ?", (PINNED,)).fetchall():
        kind = kind_of(row['origin'])
        if kind in dead:
            db.execute("UPDATE scout_candidates SET status = 'expired' WHERE key = ?", (row['key'],))
            out[kind] += 1
    db.commit()
    return dict(out)
