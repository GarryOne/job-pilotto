# SRE Watch — notes for Claude

Personal job-search automation: crawls job boards and employer feeds, filters and scores jobs with Claude, sends a Telegram digest, tracks applications in Notion.

## Start here
1. Read the Notion page **Session Handoff — Start Here (for Claude)** (`3e562be8fd8681af9a4dd8732964fd94`) via the Notion MCP. It has the owner's preferences, every ID, current state, open threads and known gotchas.
2. Then **Technical Reference — Implementation** (`3e562be8fd868124a28ee7c044dc83dc`), the latest **Run Log** entries (`3e462be8fd868196b353cd0f0886ce57`) and the **Decision Log** (database `e4d099e66ee84f728d640d225f253210`).

## Working rules
- After each change: tests pass → commit → push to `main` → update Notion (hub current state, Run Log, Technical Reference; Decision Log when a decision changes; Handoff "Current state" / "Open threads" at the end of a session).
- Ask before spending money on AI (new model or large re-runs); show measured cost.
- Never auto-apply to jobs. Never scrape LinkedIn, Glassdoor, levels.fyi or Reddit; use public APIs and job-feed endpoints only.
- Secrets live in the macOS Keychain (`sre-watch.*`), GitHub secrets and Cloudflare Worker secrets — never in code or Notion.

## Layout
- `daily.py` orchestrates a run (modes: scheduled, run, today, more, apply); `watch.py` crawls employer feeds via `ats.py`; `discover.py` crawls jobs.ch / TechTree; `job_store.py` is the SQLite store.
- `enrich.py` (AI stage 1, Haiku 4.5), `score.py` (AI stage 2, Sonnet 5), `matches.py` (Notion Job Matches), `applications.py` (Notion client), `scout.py` (daily source discovery, seeds in `scout_seeds.json`).
- `worker/` is the Cloudflare Worker for Telegram commands and buttons (`npm test`, `npx wrangler@4 deploy`).
- Workflows: `.github/workflows/daily.yml` (every 4 h), `scout.yml` (daily).

## Tests
`python3 -m unittest discover -s tests` and `cd worker && npm test`.
