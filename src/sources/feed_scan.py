"""Reading every employer feed of a search (feeds.scan): download in parallel, place and sort the titles with AI once, keep the jobs of your
roles and places, record their seen history. Moved out of feeds.py (500-line rule); every name it uses is read from feeds at call time, so
tests patch feeds.* as before. Tests: tests/test_feed_scan_parallel.py, tests/test_coverage.py, tests/test_non_it_crawl.py."""
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import feeds


def scan(sources, db, fetcher=None, details=None):
    """Fetch every source, keep SRE-type titles in preferred locations, record seen history. report['funnel'] counts what the
    crawl saw and what the role keywords caught (src/coverage.py), so a search that is too narrow can be said out loud."""
    fetcher = fetcher or feeds.fetch
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    key = lambda source: f'{source.get("ats", "greenhouse")}:{source.get("slug") or source["board"]}'
    with db:   # the end-to-end journey's fixture feeds answer the same every run: nothing rests there
        db.execute(feeds.REST_TABLE)
        rest = {} if os.getenv('JOB_PILOTTO_FIXTURE_DIR') else feeds.resting(db, now)
    rested = [source for source in sources if key(source) in rest]
    sources = [source for source in sources if key(source) not in rest]
    if rested:   # said every run, so a short list is never a mystery
        print(f'Employers resting: {len(rested)} gave no match for your roles in your places {feeds.REST_AFTER} checks in a row; checked again after '
              f'{min(rest[key(source)] for source in rested)[:10]}.')
    from ..progress import Ticker
    ticker, lock, read = Ticker('Reading employer job sites', len(sources)), threading.Lock(), [0, 0]   # [sites read, jobs listed]

    def fetch(source):
        got = feeds._fetched(fetcher, source)
        with lock:
            read[0] += 1
            read[1] += len(got[0] or [])
            ticker.tick(read[0], f' · {read[1]:,} jobs listed')
        feeds.run_counts.looked(got[0] or [])   # this search's own number, each job once (src/run_counts.py)
        return got
    with ThreadPoolExecutor(max_workers=feeds.FETCH_WORKERS) as pool:   # a few hundred feeds must fit in the job's time
        downloads = list(pool.map(fetch, sources))
    from .. import time_budget
    time_budget.restart()   # downloading is not AI time: the places, titles and scoring after it get the whole budget (src/time_budget.py)
    report = {"generated_at": now, "sources": [], "jobs": [], "rested": len(rested)}
    tally = feeds.coverage.Tally()
    feeds.triage_places([job for jobs, failure in downloads if not failure for job in jobs or []])   # where the new locations are: Claude, once each
    feeds.triage([job for jobs, failure in downloads if not failure for job in jobs or []])   # titles the words miss: Claude sorts the new ones, once
    for source, (jobs, failure) in zip(sources, downloads):
        board = f'{source.get("ats", "greenhouse")}:{source.get("slug") or source["board"]}'
        try:
            if failure:
                raise failure
            matched = []
            tally.feed()
            with db:
                for job in jobs:
                    in_place, hit = feeds.wanted_location(job), feeds.wanted_title(job["title"])
                    tally.add(job["title"], in_place, hit, excluded=feeds.excluded_title(job["title"]), location=job["location"],
                              dropped_by=feeds.dropped_by(job["title"]))
                    if hit and in_place:
                        matched.append({
                            "company": job.get("employer") or source["company"], "id": str(job["id"]),   # a portal's jobs keep their own employer (visits.py)
                            "title": job["title"], "location": job["location"] or "Unspecified",
                            "url": job["url"], "date_posted": job.get("date_posted") or "",
                            "description": job.get("description") or "",
                            "work_mode": "Remote (stated)" if job.get("remote") else "",
                            "salary_text": job.get("salary") or "",
                            "status": feeds.record(db, board, job, now)
                        })
            # A board whose list has no description: fetch it for the jobs kept (a handful), so they can be scored.
            detail = (details if details is not None else feeds.ats.DETAILS).get(source.get("ats", "greenhouse"))
            for item in matched if detail else []:
                if not item["description"]:
                    try:
                        item["description"] = detail(source.get("slug") or source["board"], item["id"]) or ""
                    except Exception as error:  # one posting failing must not drop the others
                        print(f'Warning: {source["company"]} {item["id"]}: description not fetched: {type(error).__name__}')
            with db:
                feeds._after_check(db, board, bool(matched), now)
            feeds.run_counts.matched(matched)
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
