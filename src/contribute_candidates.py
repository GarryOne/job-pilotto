"""Candidate postings the weekly discovery batch may record (owner, 17 Oct 2026): up to 40 public posting addresses from this install's own matches and started
applications, shared with the pool like the other facts ("Help the pool grow", src/contribute.py). Only the address, its host and where it came from leave: never a title,
company name, location, score, note or stage. A posting with a query or fragment is skipped (that is where a person's filters sit). Guard: tests/test_contribute_candidates.py."""
import re
from urllib.parse import urlsplit

LIMIT = 40
PER_HOST = 3
HOST = re.compile(r'[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}')
APPLYING = 'Applying'   # the stage of an application started and not sent: the closest the engine has to "stuck" (the journeys log lives in the app)


def clean(url):
    """The posting address if it is a plain public https page (no user, port, query, fragment), else None."""
    if not isinstance(url, str) or len(url) > 200 or not url.startswith('https://'):
        return None
    parts = urlsplit(url)
    host = (parts.hostname or '').lower()
    if parts.query or parts.fragment or parts.username or parts.password or parts.port or len(parts.path) < 2 or not HOST.fullmatch(host) or host.startswith('e2e'):
        return None
    return url


def candidates(db, stages=None, limit=LIMIT):
    """[{url, host, source}]: started applications first ('applying'), then open matches from employers' own feeds ('matches'), newest first, at most PER_HOST a host.
    Job boards are left out: their apply link leaves the board. `stages`: {url: stage} from the application store."""
    if db is None:
        return []
    try:
        rows = db.execute("""SELECT j.url FROM jobs j JOIN sources s ON s.id = j.source_id
            WHERE j.state = 'open' AND s.kind = 'employer feed' ORDER BY j.first_seen_at DESC LIMIT 600""").fetchall()
    except Exception:  # noqa: BLE001 — no job tables yet: nothing to share
        return []
    started = {url for url, stage in (stages or {}).items() if stage == APPLYING}
    urls = [row[0].strip() for row in rows]
    ordered = [(url, 'applying') for url in urls if url in started] + [(url, 'matches') for url in urls if url not in started]
    out, per_host, seen = [], {}, set()
    for url, source in ordered:
        good = clean(url)
        host = (urlsplit(good).hostname or '').lower() if good else ''
        if not good or good in seen or per_host.get(host, 0) >= PER_HOST:
            continue
        seen.add(good)
        per_host[host] = per_host.get(host, 0) + 1
        out.append({'url': good, 'host': host, 'source': source})
        if len(out) >= limit:
            break
    return out
