# Job Pilotto — notes for Claude

Personal job-search automation: crawls job boards and employer feeds, filters and scores jobs with Claude, sends a Telegram digest, tracks applications in Notion.

## Start here
1. Read the Notion page **Session Handoff — Start Here (for Claude)** (`3e562be8fd8681af9a4dd8732964fd94`) via the Notion MCP. It has the owner's preferences, current state, open threads and known gotchas.
2. Then **Technical Reference — Implementation** (`3e562be8fd868124a28ee7c044dc83dc`), the latest **Run Log** entries and the **Decision Log**.
3. For any other Notion page/database ID, or to find where something lives, use the skill **notion-map** (`.claude/skills/notion-map/SKILL.md`) instead of searching from scratch.

## Working rules
- Code changes happen in a git worktree on their own branch (see AGENTS.md → Working with git); other agents work on this repo at the same time.
- After each change: tests pass → commit → push to `main` → update Notion (hub current state, Run Log, Technical Reference; Decision Log when a decision changes; Handoff "Current state" / "Open threads" at the end of a session).
- Ask before spending money on AI (new model or large re-runs); show measured cost.
- Never auto-apply to jobs: the application kit drafts, the owner submits. Never scrape LinkedIn, Glassdoor, levels.fyi or Reddit; use public APIs and job-feed endpoints only.
- Secrets live in the macOS Keychain (`job-pilotto.*`), GitHub secrets and Cloudflare Worker secrets — never in code or Notion.

## Layout
- Python package `src/` (run with `python -m src <daily|scout|discover|feeds|enrich>`): `daily.py` orchestrates a run; `digest.py` ranking/rotation/paging/layout/buttons; `telegram.py` sending; `store.py` SQLite; `scout.py` source scout; `paths.py` repo paths; `features.py` optional-feature registry and the `JOB_PILOTTO_DISABLE` switch (only the crawl + digest core is required; new features must be optional, on when their keys exist, and listed there).
- `src/sources/` (`ats.py` feed adapters, `feeds.py` employer-feed crawl, `boards.py` jobs.ch/TechTree), `src/ai/` (`enrich.py` stage 1 Haiku 4.5, `score.py` stage 2 Sonnet 5, `kit.py` application kit Sonnet 5 on 📝 Prepare or auto-drafted, `apply_batch.py` queues kits into the ChatGPT/Codex desktop app, `insights.py` daily insight + Monday weekly report: code stats + Sonnet 5 → Telegram and 💡 Insights, `interviews.py` transcript/notes sent to the bot → 🎤 Interviews, `mail.py` Gmail + Calendar → events/Stage/Next interview/prep messages; client in `src/sources/google.py`), `src/notion/` (`client.py` Notion API, `matches.py` Job Matches sync, `ledger.py` application record frozen at Applied + 📈 Application Events outcome history + scheduled sync/no-response rule, `funnel.py` funnel conversion + step to improve → 🎯 Pipeline page, no AI).
- `config/` holds editable settings: `preferences.json`, `sources.json`, `scout_seeds.json`.
- `worker/` is the Cloudflare Worker for Telegram commands and buttons (`npm test`, `npx wrangler@4 deploy`).
- Workflows: `.github/workflows/daily.yml`, `scout.yml`, `mail.yml` are the engine: reusable (`workflow_call`) and manual, with no schedule, so this public repo never runs on anyone's data. The schedules (daily every 4 h, scout daily, mail 3x a day and 5 min after applying) live in each user's private repo, from `templates/github-actions/` (the owner's: `GarryOne/job-pilotto-private`).
- `desktop/lib/github.js`: the app's "Keep searching while my Mac is off": GitHub device-flow sign-in, creates `<user>/job-pilotto-private`, commits the templates + the user's `config/search.json`/`preferences.json` (overlaid on the defaults by the engine), sets sealed secrets and variables; while on, Telegram buttons dispatch there and the Jobs list comes from the latest `job-pilotto-jobs-db` artifact.
- Notion IDs have no defaults in code: they come from the environment (`.env`, repository variables, or the Desktop App).

## Tests
`python3 -m unittest discover -s tests`, `cd worker && npm test` and `cd desktop && npm test`.
A Claude Code hook (`.claude/settings.json` → `tools/pre-push-check.sh`) runs all of them, plus the
Python suite without credentials as CI sees it, before every `git push` and blocks the push if one
fails, so only green builds reach GitHub. It also lints the workflow files (`actionlint`, with
shellcheck on each `run:` script) and, when a `package.json` or lock file changed, proves `npm ci`
works from scratch, the two CI-only failure classes the tests can't see.
