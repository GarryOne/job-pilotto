#!/usr/bin/env python3
"""Small, dependency-free job watcher. Python 3.10+."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sqlite3
import unicodedata
import urllib.request

from . import ats
from .. import coverage
from ..paths import CONFIG, DATA, REPORTS, keyword_regex, load_search_config

DESCRIPTION_LIMIT = 12000
_SEARCH = load_search_config()


def plain_text(markup):
    """Greenhouse sends HTML-escaped HTML; return readable plain text."""
    markup = html.unescape(markup or "")
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", markup))).strip()[:DESCRIPTION_LIMIT]


# Feed jobs whose title doesn't match config/search.json's role_keywords never reach the digest.
TITLES = keyword_regex(_SEARCH['role_keywords'])
# Titles that contain a role keyword but are another job entirely ("Infrastructure Tax Lead", "SAP ABAP
# Developer"): dropped before any AI step, from feeds, job boards and Google Jobs alike.
EXCLUDED_TITLES = keyword_regex(_SEARCH.get('title_exclude_keywords') or [r'(?!x)x'])


TRIAGED = None   # {title: could fit} decided by Claude for this search (src/ai/title_triage.py), read once a run


def wanted_title(title):
    """A title we score: none of title_exclude_keywords, and a role keyword or, when the words miss it, Claude's "could fit" for this search
    (src/ai/title_triage.py; owner, 7 Oct 2026: "Only the location should be strict")."""
    if EXCLUDED_TITLES.search(title or '') or EXCLUDED_TITLES.search(plain(title)):
        return False
    if TITLES.search(title or '') or TITLES.search(plain(title)):
        return True
    return bool(_triaged().get(' '.join(str(title or '').lower().split())[:160]))


def _triaged():
    global TRIAGED
    if TRIAGED is None:
        try:
            from ..ai import title_triage
            TRIAGED = dict(title_triage.known(_SEARCH))
        except Exception:  # noqa: BLE001 — nothing decided yet: the exact words only
            TRIAGED = {}
    return TRIAGED


def triage(jobs):
    """Ask Claude about the titles of these jobs that are in the user's places and that the role words miss (once per title and search).
    Off without AI or with JOB_PILOTTO_DISABLE=title_triage: the exact words only."""
    from .. import features
    from ..ai import engine
    from ..time_budget import best_first   # your best places' titles first: a short search sorts them before the rest
    titles = [job.get('title') for job in best_first(jobs) if job.get('title') and wanted_location(job) and not excluded_title(job['title'])
              and not (TITLES.search(job['title']) or TITLES.search(plain(job['title'])))]
    if not titles or features.disabled('title_triage') or not engine.ready():
        return
    try:
        from ..ai import title_triage
        _triaged().update(title_triage.decide(titles, _SEARCH))
    except Exception as error:  # noqa: BLE001 — not sorted this run: the exact words only, said
        print(f'Warning: job titles not sorted by Claude ({type(error).__name__}): only your role words match this run')


def excluded_title(title):
    return bool(EXCLUDED_TITLES.search(title or '') or EXCLUDED_TITLES.search(plain(title)))


EXCLUDED_EACH = [(fragment, keyword_regex([fragment])) for fragment in _SEARCH.get('title_exclude_keywords') or []]


def dropped_by(title):
    """The excluded-title word that drops a title the role keywords catch ('' when none): counted, so the app can say what a word costs."""
    if not (TITLES.search(title or '') or TITLES.search(plain(title))):
        return ''
    return next((fragment for fragment, pattern in EXCLUDED_EACH if pattern.search(title or '') or pattern.search(plain(title))), '')

# Feed jobs outside these places (config/search.json's locations, plus generic remote synonyms)
# are dropped before they reach the digest or the AI stages.
# Only the user's places (7 Oct 2026: a hard-coded \bch\b and UAE, left from the first search, let every Swiss town in for a
# Romandie search; a place word "Switzerland" adds \bch\b itself, src/regions.py).
_PLACES = [*_SEARCH['locations']['top_tier'], *_SEARCH['locations']['country_wide'], *_SEARCH['locations']['abroad']]
PLACE = keyword_regex(_PLACES)
_REMOTE_SYNONYMS = r'remote|anywhere|worldwide|global|emea|europe'


def fetch(source):
    """Normalised jobs for one source: {'company', 'ats' (default greenhouse), 'slug' or legacy 'board'}."""
    return ats.fetch(source.get("ats", "greenhouse"), source.get("slug") or source["board"])


# Remote roles restricted to these regions (config/search.json) are not open to someone in your places.
REMOTE_ELSEWHERE = keyword_regex(_SEARCH['remote_excluded_regions'] or [r'(?!x)x'])   # no region skipped: an empty pattern would match every text and drop every remote job


def plain(text):
    """The text without accents ("Zürich" -> "Zurich"): a place typed without its umlaut still finds the posting that has it."""
    return "".join(c for c in unicodedata.normalize("NFKD", text or "") if not unicodedata.combining(c))


def remote_wanted(search=None):
    """False when the settings' "Remote jobs" says no (7 Oct 2026: a photographer and shop seller wants jobs in Geneva and Lausanne only)."""
    said = [str(v).strip().lower() for v in ((search or _SEARCH).get('remote_jobs') or [])]
    return not any(v in ('no', 'non', 'nein', 'none', 'never', 'off', 'false') for v in said)


REMOTE_WANTED = remote_wanted()


PLACED = None   # {location: 'best' | 'in' | 'out'} decided by Claude for these places (src/ai/place_triage.py), read once a run


def placed():
    global PLACED
    if PLACED is None:
        try:
            from ..ai import place_triage
            PLACED = dict(place_triage.known(_SEARCH))
        except Exception:  # noqa: BLE001 — the place words then decide
            PLACED = {}
    return PLACED


def place_of(job):
    """Claude's answer for this job's location ('best', 'in', 'out'), or None when it has not placed it (the place words decide then)."""
    from ..ai.place_triage import norm
    return placed().get(norm(job.get('location'))) if (job.get('location') or '').strip() else None


def triage_places(jobs):
    """Ask Claude where the new locations are, for the jobs that could be kept (their title fits); each location once per version of the
    places. Off without AI or with JOB_PILOTTO_DISABLE=place_triage: the place words only."""
    from .. import features
    from ..ai import engine
    locations = [job.get('location') for job in jobs if (job.get('location') or '').strip() and job.get('title') and wanted_title(job['title'])]
    if not locations or features.disabled('place_triage') or not engine.ready():
        return
    try:
        from ..ai import place_triage
        placed().update(place_triage.decide(locations, _SEARCH))
    except Exception as error:  # noqa: BLE001 — not placed this run: the place words decide, said
        print(f'Warning: job locations not placed by Claude ({type(error).__name__}): your place words decide this run')


def wanted_location(job):
    """One of your places: Claude's answer for this location when it has placed it (src/ai/place_triage.py); else the place words
    (config/search.json), or remote that isn't limited elsewhere (unless you want no remote jobs)."""
    verdict = place_of(job)
    if verdict is not None:
        return verdict != 'out'
    where = job.get("location") or ""
    if PLACE.search(where) or PLACE.search(plain(where)):
        return True
    if not REMOTE_WANTED:
        return False
    said = re.search(_REMOTE_SYNONYMS, where, re.I)
    # A posting whose place is only a city elsewhere is based there, even when its feed flags it remote (7 Oct 2026: "London" and "Singapore"
    # account executive jobs reached a Geneva search). One that says remote in its place ("Remote, Germany") is judged by the regions you skip.
    if job.get("remote") and not said and where.strip():
        return False
    return bool(job.get("remote") or said) and not REMOTE_ELSEWHERE.search(where)


def database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    # Its own table name: this file is also the canonical store (src/store.py), whose `jobs` table has a
    # different schema. Sharing the name made every feed insert fail after the 25 Sep 2026 file rename.
    db.execute("""CREATE TABLE IF NOT EXISTS feed_jobs (
        board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT,
        PRIMARY KEY(board, id))""")
    return db


def record(db, board, job, now):
    # Source timestamps aren't publication dates. Compare the actual listing fields.
    fingerprint = hashlib.sha256(json.dumps({
        "title": job["title"], "location": job["location"],
        "url": job["url"]
    }, sort_keys=True).encode()).hexdigest()
    previous = db.execute("SELECT fingerprint FROM feed_jobs WHERE board=? AND id=?",
                          (board, str(job["id"]))).fetchone()
    status = "new" if previous is None else "changed" if previous[0] != fingerprint else "seen"
    db.execute("""INSERT INTO feed_jobs VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(board, id) DO UPDATE SET
        fingerprint=excluded.fingerprint, last_seen=excluded.last_seen""",
        (board, str(job["id"]), fingerprint, now, now))
    return status


FETCH_WORKERS = 8   # feeds downloaded at once; the database work below stays sequential


def _fetched(fetcher, source):
    try:
        return fetcher(source), None
    except Exception as error:  # noqa: BLE001 — reported per source below
        return None, error


# An employer that gave this search nothing (no title match in its places) REST_AFTER checks in a row is skipped for REST_DAYS, then checked
# again (6 Oct 2026: a photographer's checks read 190 software employers every 4 hours for 0 matches). Per install, learned from its own crawl;
# a change of roles or places starts over, since what fits then is different.
REST_AFTER, REST_DAYS = 5, 7
REST_TABLE = 'CREATE TABLE IF NOT EXISTS feed_rest (board TEXT PRIMARY KEY, misses INTEGER NOT NULL, rest_until TEXT, search TEXT NOT NULL)'


def _readers():
    """A fingerprint of the job readers: an employer resting under older readers (which may have read it wrong) is woken by a release."""
    digest = hashlib.sha256()
    for name in ('ats.py', 'careers.py', 'render.py', 'feeds.py'):
        try:
            digest.update((Path(__file__).parent / name).read_bytes())
        except OSError:
            digest.update(name.encode())
    return digest.hexdigest()[:12]


READERS = _readers()


def _search_digest(search=None):
    """What a rest depends on: the roles and places searched, and the readers that found nothing (either changing starts over)."""
    search = search or _SEARCH
    return hashlib.sha256(json.dumps([search.get('role_keywords'), search.get('locations'), READERS], sort_keys=True, default=str).encode()).hexdigest()[:12]


def resting(db, now, search=None):
    """The boards resting now ({board: until}); rows of an earlier search are dropped first."""
    db.execute(REST_TABLE)
    db.execute('DELETE FROM feed_rest WHERE search != ?', (_search_digest(search),))
    return {row[0]: row[1] for row in db.execute('SELECT board, rest_until FROM feed_rest WHERE rest_until > ?', (now,))}


def runway(rows, now):
    """How long your employers last (owner, 7 Oct 2026: "how many turns until I exhaust my employers"): rows are feed_rest's (misses, rest_until).
    {'resting', 'until'}: resting now, and when the first of them wakes; {'runs', 'count'}: the next searches with nothing for you after which
    `count` more rest (the biggest group, the sooner of a tie). An employer with a match starts again from 0, so this is the most it can be."""
    resting = sorted(until for _, until in rows if until and until > now)
    left = {}
    for misses, until in rows:
        if not (until and until > now) and misses:
            runs = max(1, REST_AFTER - misses)
            left[runs] = left.get(runs, 0) + 1
    soon = None
    if left:
        runs = max(left, key=lambda k: (left[k], -k))
        soon = {'runs': runs, 'count': sum(n for k, n in left.items() if k <= runs)}
    return {'resting': len(resting), 'until': resting[0] if resting else None, 'soon': soon, 'rest_after': REST_AFTER, 'rest_days': REST_DAYS}


def _after_check(db, board, matched, now, search=None):
    if matched:
        db.execute('DELETE FROM feed_rest WHERE board = ?', (board,))
        return
    row = db.execute('SELECT misses FROM feed_rest WHERE board = ?', (board,)).fetchone()
    misses = (row[0] if row else 0) + 1
    until = (datetime.fromisoformat(now) + timedelta(days=REST_DAYS)).isoformat(timespec='seconds') if misses >= REST_AFTER else None
    db.execute('INSERT OR REPLACE INTO feed_rest (board, misses, rest_until, search) VALUES (?, ?, ?, ?)', (board, misses, until, _search_digest(search)))


def scan(sources, db, fetcher=fetch, details=None):
    """Fetch every source, keep SRE-type titles in preferred locations, record seen history. report['funnel'] counts what the
    crawl saw and what the role keywords caught (src/coverage.py), so a search that is too narrow can be said out loud."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    key = lambda source: f'{source.get("ats", "greenhouse")}:{source.get("slug") or source["board"]}'
    with db:   # the end-to-end journey's fixture feeds answer the same every run: nothing rests there
        db.execute(REST_TABLE)
        rest = {} if os.getenv('JOB_PILOTTO_FIXTURE_DIR') else resting(db, now)
    rested = [source for source in sources if key(source) in rest]
    sources = [source for source in sources if key(source) not in rest]
    if rested:   # said every run, so a short list is never a mystery
        print(f'Employers resting: {len(rested)} gave no match for your roles in your places {REST_AFTER} checks in a row; checked again after '
              f'{min(rest[key(source)] for source in rested)[:10]}.')
    from ..progress import Ticker
    import threading
    ticker, lock, read = Ticker('Reading employer job sites', len(sources)), threading.Lock(), [0, 0]   # [sites read, jobs listed]

    def fetch(source):
        got = _fetched(fetcher, source)
        with lock:
            read[0] += 1
            read[1] += len(got[0] or [])
            ticker.tick(read[0], f' · {read[1]:,} jobs listed')
        return got
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:   # a few hundred feeds must fit in the job's time
        downloads = list(pool.map(fetch, sources))
    report = {"generated_at": now, "sources": [], "jobs": [], "rested": len(rested)}
    tally = coverage.Tally()
    triage_places([job for jobs, failure in downloads if not failure for job in jobs or []])   # where the new locations are: Claude, once each
    triage([job for jobs, failure in downloads if not failure for job in jobs or []])   # titles the words miss: Claude sorts the new ones, once
    for source, (jobs, failure) in zip(sources, downloads):
        board = f'{source.get("ats", "greenhouse")}:{source.get("slug") or source["board"]}'
        try:
            if failure:
                raise failure
            matched = []
            tally.feed()
            with db:
                for job in jobs:
                    in_place, hit = wanted_location(job), wanted_title(job["title"])
                    tally.add(job["title"], in_place, hit, excluded=excluded_title(job["title"]), location=job["location"], dropped_by=dropped_by(job["title"]))
                    if hit and in_place:
                        matched.append({
                            "company": job.get("employer") or source["company"], "id": str(job["id"]),   # a portal's jobs keep their own employer (visits.py)
                            "title": job["title"], "location": job["location"] or "Unspecified",
                            "url": job["url"], "date_posted": job.get("date_posted") or "",
                            "description": job.get("description") or "",
                            "work_mode": "Remote (stated)" if job.get("remote") else "",
                            "salary_text": job.get("salary") or "",
                            "status": record(db, board, job, now)
                        })
            # A board whose list has no description: fetch it for the jobs kept (a handful), so they can be scored.
            detail = (details if details is not None else ats.DETAILS).get(source.get("ats", "greenhouse"))
            for item in matched if detail else []:
                if not item["description"]:
                    try:
                        item["description"] = detail(source.get("slug") or source["board"], item["id"]) or ""
                    except Exception as error:  # one posting failing must not drop the others
                        print(f'Warning: {source["company"]} {item["id"]}: description not fetched: {type(error).__name__}')
            with db:
                _after_check(db, board, bool(matched), now)
            report["jobs"].extend(matched)
            report["sources"].append({"company": source["company"], "ok": True,
                                      "total": len(jobs), "matches": len(matched)})
        except Exception as error:
            report["sources"].append({"company": source["company"], "ok": False, "ats": source.get("ats", "greenhouse"), "slug": source.get("slug") or source.get("board"),
                                      "error": f"{type(error).__name__}: {error}"})
    report["jobs"].sort(key=lambda j: ({"new": 0, "changed": 1, "seen": 2}[j["status"]], j["company"], j["title"]))
    report["funnel"] = tally.summary()
    # How much of the employer list still brings jobs (the "Your employers" meter, owner 7 Oct 2026): feeds read, and those with a match this run.
    read = [s for s in report["sources"] if s.get("ok")]
    report["funnel"]["employers"] = {"read": len(read), "matched": sum(1 for s in read if s.get("matches"))}
    return report


def render(report):
    esc = lambda value: html.escape(str(value), quote=True)
    jobs = report["jobs"]
    new = sum(j["status"] == "new" for j in jobs)
    failed = sum(not s["ok"] for s in report["sources"])
    rows = "".join(
        f'<article data-search="{esc(j["company"] + " " + j["title"] + " " + j["location"])}">'
        f'<small>{esc(j["company"])} · {esc(j["status"])}</small>'
        f'<h2><a href="{esc(j["url"])}" target="_blank" rel="noopener noreferrer">{esc(j["title"])}</a></h2>'
        f'<p>{esc(j["location"])}</p></article>' for j in jobs)
    sources = "".join(f'<li>{esc(s["company"])}: ' +
        (f'{s["total"]} postings, {s["matches"]} title matches' if s["ok"] else f'FAILED — {esc(s["error"])}') + '</li>'
        for s in report["sources"])
    return f'''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Job Pilotto</title>
<style>body{{font:17px system-ui;background:#f4f6fa;color:#182537;max-width:850px;margin:40px auto;padding:0 20px}}
article{{background:white;border:1px solid #dae1e9;padding:20px;border-radius:12px;margin:14px 0}}h2{{font-size:20px;margin:8px 0}}
a{{color:#165bba}}small{{color:#526173}}input{{box-sizing:border-box;width:100%;padding:14px;font:inherit;border:1px solid #8294ac;border-radius:8px}}
[hidden]{{display:none}}p{{line-height:1.5}}</style>
<h1>Job Pilotto</h1><p>{len(jobs)} matching postings · {new} newly seen · {failed} failed sources</p>
<p>Last scan: {esc(report["generated_at"])}. New means first seen by this watcher, not newly published.</p>
<p>Worldwide title matches. Location eligibility, seniority and remote conditions have not been screened.</p>
<label for="filter">Filter by company, title or location</label><input id="filter" placeholder="e.g. Switzerland, remote, platform">
<p id="count" aria-live="polite"></p>
{rows or '<p>No matching jobs returned. Check source status below.</p>'}
<details><summary>Source status</summary><ul>{sources}</ul></details>
<script>const input=document.querySelector('#filter');input.addEventListener('input',()=>{{let count=0;
document.querySelectorAll('article').forEach(el=>{{el.hidden=!el.dataset.search.toLowerCase().includes(input.value.toLowerCase());if(!el.hidden)count++;}});
document.querySelector('#count').textContent=count+' visible jobs';}});</script></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DATA)
    parser.add_argument("--reports-dir", type=Path, default=REPORTS)
    args = parser.parse_args()
    from .. import scout
    sources = scout.starter_list()
    with database(args.data_dir / "jobs.sqlite") as db:
        report = scan(sources, db)
    args.reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    for name in (stamp, "latest"):
        (args.reports_dir / f"{name}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        (args.reports_dir / f"{name}.html").write_text(render(report), encoding="utf-8")
    print(json.dumps({"matches": len(report["jobs"]), "new": sum(j["status"] == "new" for j in report["jobs"]),
                      "sources": report["sources"], "report": str(args.reports_dir / "latest.html")}, indent=2))
    return 1 if any(not s["ok"] for s in report["sources"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
