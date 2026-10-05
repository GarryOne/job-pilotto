#!/usr/bin/env python3
"""Small, dependency-free job watcher. Python 3.10+."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import html
import json
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


def wanted_title(title):
    """A role title we crawl for: matches role_keywords and none of title_exclude_keywords."""
    return bool(TITLES.search(title or '') or TITLES.search(plain(title))) and not (EXCLUDED_TITLES.search(title or '') or EXCLUDED_TITLES.search(plain(title)))


def excluded_title(title):
    return bool(EXCLUDED_TITLES.search(title or '') or EXCLUDED_TITLES.search(plain(title)))

# Feed jobs outside these places (config/search.json's locations, plus generic remote synonyms)
# are dropped before they reach the digest or the AI stages.
_PLACES = [*_SEARCH['locations']['top_tier'], *_SEARCH['locations']['country_wide'],
          *_SEARCH['locations']['abroad'], r'\bch\b', r'\buae\b', 'united arab emirates']
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


def wanted_location(job):
    """One of your preferred places (config/search.json), or remote that isn't limited elsewhere."""
    where = job.get("location") or ""
    if PLACE.search(where) or PLACE.search(plain(where)):
        return True
    remote = job.get("remote") or re.search(_REMOTE_SYNONYMS, where, re.I)
    return bool(remote) and not REMOTE_ELSEWHERE.search(where)


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


def scan(sources, db, fetcher=fetch, details=None):
    """Fetch every source, keep SRE-type titles in preferred locations, record seen history. report['funnel'] counts what the
    crawl saw and what the role keywords caught (src/coverage.py), so a search that is too narrow can be said out loud."""
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:   # a few hundred feeds must fit in the job's time
        downloads = list(pool.map(lambda source: _fetched(fetcher, source), sources))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    report = {"generated_at": now, "sources": [], "jobs": []}
    tally = coverage.Tally()
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
                    tally.add(job["title"], in_place, hit, excluded=excluded_title(job["title"]), location=job["location"])
                    if hit and in_place:
                        matched.append({
                            "company": source["company"], "id": str(job["id"]),
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
            report["jobs"].extend(matched)
            report["sources"].append({"company": source["company"], "ok": True,
                                      "total": len(jobs), "matches": len(matched)})
        except Exception as error:
            report["sources"].append({"company": source["company"], "ok": False,
                                      "error": f"{type(error).__name__}: {error}"})
    report["jobs"].sort(key=lambda j: ({"new": 0, "changed": 1, "seen": 2}[j["status"]], j["company"], j["title"]))
    report["funnel"] = tally.summary()
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
    sources = json.loads((CONFIG / "sources.json").read_text())
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
