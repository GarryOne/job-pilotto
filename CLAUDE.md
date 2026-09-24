# Job Pilotto — notes for Claude

Personal job-search automation: crawls job boards and employer feeds, filters and scores jobs with Claude, sends a Telegram digest, tracks applications in Notion.

## Start here
1. Read the Notion page **Session Handoff — Start Here (for Claude)** (`3e562be8fd8681af9a4dd8732964fd94`) via the Notion MCP. It has the owner's preferences, current state, open threads and known gotchas.
2. Then **Technical Reference — Implementation** (`3e562be8fd868124a28ee7c044dc83dc`), the latest **Run Log** entries and the **Decision Log**.
3. For any other Notion page/database ID, or to find where something lives, use the skill **notion-map** (`.claude/skills/notion-map/SKILL.md`) instead of searching from scratch.

## Working rules
- After each change: tests pass → commit → push to `main` → update Notion (hub current state, Run Log, Technical Reference; Decision Log when a decision changes; Handoff "Current state" / "Open threads" at the end of a session).
- Ask before spending money on AI (new model or large re-runs); show measured cost.
- Never auto-apply to jobs: the application kit drafts, the owner submits. Never scrape LinkedIn, Glassdoor, levels.fyi or Reddit; use public APIs and job-feed endpoints only.
- Secrets live in the macOS Keychain (`job-pilotto.*`), GitHub secrets and Cloudflare Worker secrets — never in code or Notion.

## Layout
- Python package `src/` (run with `python -m src <daily|scout|discover|feeds|enrich>`): `daily.py` orchestrates a run; `digest.py` ranking/rotation/paging/layout/buttons; `telegram.py` sending; `store.py` SQLite; `scout.py` source scout; `paths.py` repo paths.
- `src/sources/` (`ats.py` feed adapters, `feeds.py` employer-feed crawl, `boards.py` jobs.ch/TechTree), `src/ai/` (`enrich.py` stage 1 Haiku 4.5, `score.py` stage 2 Sonnet 5, `kit.py` application kit Sonnet 5 on 📝 Prepare or auto-drafted, `apply_batch.py` queues kits into the ChatGPT/Codex desktop app), `src/notion/` (`client.py` Notion API, `matches.py` Job Matches sync).
- `config/` holds editable settings: `preferences.json`, `sources.json`, `scout_seeds.json`.
- `worker/` is the Cloudflare Worker for Telegram commands and buttons (`npm test`, `npx wrangler@4 deploy`).
- Workflows: `.github/workflows/daily.yml` (every 4 h), `scout.yml` (daily).

## Tests
`python3 -m unittest discover -s tests` and `cd worker && npm test`.
