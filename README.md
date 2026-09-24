# SRE Watch

Personal job-search automation for SRE / platform / DevOps roles in Switzerland (Zurich preferred), Berlin, London, Dubai and remote.

Every 4 hours it crawls job boards and employer job feeds, lets Claude read each posting and score its fit against a CV-based profile, and sends a short ranked digest to Telegram. Applications are tracked in Notion. It never applies on your behalf.

```
Job boards + employer feeds ──▶ crawl (GitHub Actions, every 4 h)
                                  │  SQLite state in the Actions cache
                                  ▼
                   AI stage 1: facts (Claude Haiku 4.5)
                   AI stage 2: fit score vs Profile (Claude Sonnet 5)
                                  │
             ┌────────────────────┴────────────────────┐
             ▼                                         ▼
   Telegram digest (top 10, buttons)          Notion: Job Matches,
             │                                Applications, Employers
             ▼
   Cloudflare Worker ── commands and buttons ──▶ GitHub Actions runs
```

## What you get

- **Telegram digest**: top 10 jobs per message, best matches first and rotating between digests. Each job shows its fit score, company, place, seniority, work mode, language and salary signals, and a one-line reason. Tap a job number to mark it **✅ Applied**, **⭐ Save** or **❌ Dismiss**; **➕ Next 10** pages through the list.
- **Commands**: `/run` (crawl now), `/today` (current list), `/applied`, `/saved`, `/scout` (find new employer feeds), `/status`, `/help`.
- **Filters**: jobs requiring German, French or Italian are hidden; only roles in the preferred places (or remote open to Europe) are kept; applied and dismissed jobs never return; jobs not seen for 7 days are closed.
- **Source scout**: once a day it checks 15 candidate employers (Tier 1 companies first, then Hacker News "Who is hiring?", open company lists and jobs.ch employers) for a public job feed, scores each feed's quality and adds the useful ones to the crawl.
- **Notion**: Job Matches (every scored job), Applications — Job Tracker, Employers & Sources, and the Profile the scorer reads.

## Repository layout

```
src/
  __main__.py        python -m src <command>
  daily.py           one digest run: crawl, AI, sync, send (modes below)
  digest.py          filtering, ranking, rotation, paging, message layout, buttons
  telegram.py        sending messages
  store.py           SQLite store (jobs, companies, AI results, shown history)
  scout.py           daily source scout
  paths.py           repository paths
  sources/
    ats.py           Greenhouse, Lever, Ashby, Workable, Recruitee, Personio,
                     SmartRecruiters, Amazon and Netflix job feeds
    feeds.py         crawls the active employer feeds
    boards.py        jobs.ch and TechTree
  ai/
    enrich.py        AI stage 1: facts from each posting, with evidence
    score.py         AI stage 2: fit score against the Notion Profile
  notion/
    client.py        Notion API: Applications, Profile, Job Matches
    matches.py       mirror of scored jobs into Notion Job Matches
config/
  preferences.json   hard filters (disqualifying languages)
  sources.json       employer feeds always crawled
  scout_seeds.json   candidate employers for the scout (Tier 1, regions)
worker/              Cloudflare Worker for the Telegram bot (commands, buttons)
tests/               Python tests; Worker tests live in worker/test/
.github/workflows/   daily.yml (every 4 h + on demand), scout.yml (daily)
```

## Commands

```sh
python3 -m src daily                  # preview a digest locally (no send)
python3 -m src daily --send --mode today
python3 -m src scout --batch 15       # probe candidate employers
python3 -m src discover --pages 2 --max-companies 80
python3 -m src feeds                  # employer feeds only, HTML report in reports/
.venv/bin/python -m src enrich --dry-run
```

`daily` modes: `scheduled` (sends only when there are new jobs), `run` (crawl + always send), `today` (no board crawl), `more` (next page of a digest), `apply` (record ✅ / ⭐ / ❌ in Notion).

AI stages run only when the GitHub variables `SRE_WATCH_ENRICH_MODEL` and `SRE_WATCH_SCORE_MODEL` are set; delete them to stop all AI spending.

## Tests

```sh
python3 -m unittest discover -s tests
cd worker && npm test
```

## Setup and documentation

Tokens live in the macOS Keychain (`sre-watch.*`), GitHub secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NOTION_TOKEN`, `ANTHROPIC_API_KEY`) and Cloudflare Worker secrets, never in the repository. `worker/setup.sh` deploys the Worker and connects the Telegram webhook.

Full documentation is in the Notion project hub: **Session Handoff — Start Here**, **Technical Reference — Implementation**, **AI Roadmap**, **Decision Log**, **Setup Guide — New User** and **User Guide — Daily Use**. `CLAUDE.md` points a new Claude session there.
