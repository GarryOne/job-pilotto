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

## Data ownership: Notion is the source of truth (one copy of everything)
Data is Notion-first. Before adding any stored field, file, setting or table, decide where it lives:
- **Notion** — anything the user reads, edits, or would want on another device: statuses, run results,
  profile/answers, open questions, contact details, learned form notes, search settings, transcripts.
  The code reads it from Notion; it never keeps a second editable copy.
- **The Mac / runner** — only keys (encrypted), large files (CVs, recordings) and caches that can be
  deleted and rebuilt from Notion or a crawl (`jobs.sqlite`, `config/*.json` as the cache of ⚙️ Search
  settings, `runs.json`). A cache is refreshed *from* Notion; writes go to Notion first, and if Notion
  refuses, nothing changes locally and the user is told.
- Notion is required in the Desktop App (decided 28 Sep 2026): the setup can't finish without it, and a
  set-up app without a Notion connection opens the Notion step. There is no Mac-only mode.
- No new "local fallback" copies of user data. A feature that needs a new database, column or page adds it
  to Notion *and* to `config/notion_schema.json` (`tools/notion_schema.py snapshot`), so every workspace can
  be rebuilt and repaired (`desktop/lib/schema.js`).
- Moving existing local data to Notion: add a step to `desktop/lib/migrate.js` (delete the local copy only
  after Notion confirmed it has it) and a test.
- Every run (search, Gmail check, kit, review) leaves a row in ⏱️ Search runs with its details, whatever
  started it, so users see what happened in Notion without the app having to show it.

## Desktop UI: one design system
- Values live in `desktop/renderer/tokens.css` only: colours, corner radii (`--r-sm|md|lg|pill`), the type scale
  (`--fs-…`), fonts, spacing (`--sp-…`), shadows. Screens use `var(--…)`. `desktop/test/design.test.js` fails on a
  raw colour, radius, font size or font family anywhere else, so a new one-off value can't reach `main`.
- Building blocks come from `components.js` + `components.css`: `pill(text, tone)`, `tag()`, `tile()`,
  `moreButton(items)` (the ⋯ menu), plus the button classes (`primary`, `secondary`, `ghost`, `link`, `danger`,
  `with-icon`). Use them; if a screen needs something new, add it there (modifiers are `is-…`, tones `tone-…`)
  and to `gallery.js`, rather than styling it once in `style.css`.
- `npm run gallery` (in `desktop/`) shows every token and component on one page; check it after changing one.
- New colour or size? Add a token (and say why) instead of a literal. The website (`site/`) has its own styles.

## Layout
- Python package `src/` (run with `python -m src <daily|scout|discover|feeds|enrich>`): `daily.py` orchestrates a run; `digest.py` ranking/rotation/paging/layout/buttons; `telegram.py` sending; `store.py` SQLite; `scout.py` source scout; `paths.py` repo paths; `features.py` optional-feature registry and the `JOB_PILOTTO_DISABLE` switch (only the crawl + digest core is required; new features must be optional, on when their keys exist, and listed there).
- `src/sources/` (`ats.py` feed adapters, `feeds.py` employer-feed crawl, `boards.py` jobs.ch/TechTree), `src/ai/` (`enrich.py` stage 1 Haiku 4.5, `score.py` stage 2 Sonnet 5, `kit.py` application kit Sonnet 5 on 📝 Prepare or auto-drafted, `apply_batch.py` queues kits into the ChatGPT/Codex desktop app, `insights.py` daily insight + Monday weekly report: code stats + Sonnet 5 → Telegram and 💡 Insights, `interviews.py` recording/transcript/notes → 🎤 Interviews rows (the app saves transcripts there, linked to the job; Notion is the database) and their review, `transcribe.py` local audio → transcript with speakers (optional add-on `requirements-transcribe.txt`: sherpa-onnx with Silero VAD, Parakeet-TDT v2 English, pyannote + 3D-Speaker ERes2Net), `mail.py` Gmail + Calendar → events/Stage/Next interview/prep messages; client in `src/sources/google.py`), `src/notion/` (`client.py` Notion API, `matches.py` Job Matches sync, `ledger.py` application record frozen at Applied + 📈 Application Events outcome history + scheduled sync/no-response rule, `funnel.py` funnel conversion + step to improve → 🎯 Pipeline page, no AI).
- `config/` holds editable settings: `preferences.json`, `sources.json`, `scout_seeds.json`.
- `desktop/lib/interviews.js` + the app's Interviews page: records (mic left, call's audio right), keeps only drafts and recordings on the Mac, saves/lists/relinks/reviews rows in Notion 🎤 Interviews. Recording needs the consent box ticked each time.
- **Product vs personal.** Product (shared, the owner's Cloudflare account, subdomain `jobpilotto`): one worker `www` from `site/` → https://www.jobpilotto.workers.dev — website, Pro waitlist (KV), Notion sign-in, and the app's form reports (`/report/fill-failure`, reusing `worker/src/report.js`; secrets `GITHUB_TOKEN`, `REPORT_TOKEN`). Personal (per user, set up in the desktop app): their Telegram bot and their scheduled runs (their private GitHub repo). Nothing in the code is tied to one Telegram bot.
- `worker/` is the Telegram bot's code (commands and buttons): the app runs it locally with long polling (`desktop/lib/telegram.js`); as a Cloudflare worker it's a per-user deployment for buttons while the computer is off: `desktop/lib/telegram-cloud.js` uploads `desktop/shared/bot-worker.js` (esbuild bundle from `scripts/stage.mjs`) as `job-pilotto-bot` to the user's own Cloudflare account with their token (Settings → Keep working while my Mac is off → Telegram buttons), sets the webhook, and the app stops long polling (`settings.telegramCloud`). Not deployed by the owner; `npm test`.
- Workflows: `.github/workflows/daily.yml`, `scout.yml`, `mail.yml` are the engine: reusable (`workflow_call`) and manual, with no schedule, so this public repo never runs on anyone's data. The schedules (daily every 4 h, scout daily, mail 3x a day and 5 min after applying) live in each user's private repo, from `templates/github-actions/` (the owner's: `GarryOne/job-pilotto-private`).
- `desktop/lib/github.js`: the app's "Keep working while my Mac is off", as a GitHub App installed on one repo only: the user creates `<user>/job-pilotto-private` from the public template `GarryOne/job-pilotto-starter` (published from `templates/github-actions` by `tools/publish-starter.sh`), installs the app on it, approves a device-flow code; the app then commits the templates + the user's `config/search.json`/`preferences.json` (overlaid on the defaults by the engine), sets sealed secrets and variables; while on, Telegram buttons dispatch there and the Jobs list comes from the latest `job-pilotto-jobs-db` artifact.
- Apply with Claude (Desktop App job row, recommended when Claude Code is installed and Notion connected): `desktop/lib/apply.js` `claudeOne` → `desktop/lib/claude-session.js` (Mac: Terminal; Windows: a console window via `start`, needs Git for Windows), one `claude --chrome --permission-mode bypassPermissions` session per job, started in the app's pipeline folder with the skill bundled (`stage.mjs` copies `.claude/skills/apply-to-job`), after a one-time consent (`settings.claudeConsent`, Settings → Apply with Claude); it follows job board → employer site → sign-up → form ("Reaching the form" in the apply-to-job skill). Employer passwords go through `python3 -m src.ai.passwords` into the Keychain / Windows Credential Manager (`job-pilotto.<host>.password`); the session's `python3` is a shim to the app's Python; confirmation emails are read with `python -m src.sources.google verify` (Gmail read-only, connected in Settings → Gmail and Calendar). Never Submit.
- Form-filling improvement loop: every extension fill is logged to Agent Runs (field table + debug JSON); `tools/fill-failures.py` groups what was left; the **improve-filling** skill (`.claude/skills/improve-filling/SKILL.md`) turns the top failures into tested fixes. Data gaps go to the app's "Answer once" list.
- Notion IDs have no defaults in code: they come from the environment (`.env`, repository variables, or the Desktop App).

## Tests
`python3 -m unittest discover -s tests`, `cd worker && npm test` and `cd desktop && npm test`.
A Claude Code hook (`.claude/settings.json` → `tools/pre-push-check.sh`) runs all of them, plus the
Python suite without credentials as CI sees it, before every `git push` and blocks the push if one
fails, so only green builds reach GitHub. It also lints the workflow files (`actionlint`, with
shellcheck on each `run:` script) and, when a `package.json` or lock file changed, proves `npm ci`
works from scratch, the two CI-only failure classes the tests can't see.
