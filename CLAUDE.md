# Job Pilotto — notes for Claude

Personal job-search automation: crawls job boards and employer feeds, filters and scores jobs with Claude, sends a Telegram digest, tracks applications in Notion.

## Start here
1. Read the Notion page **Session Handoff — Start Here (for Claude)** (`3e562be8fd8681af9a4dd8732964fd94`) via the Notion MCP. It has the owner's preferences, current state, open threads and known gotchas.
2. Then **Technical Reference — Implementation** (`3e562be8fd868124a28ee7c044dc83dc`), the latest **Run Log** entries and the **Decision Log**.
3. For any other Notion page/database ID, or to find where something lives, use the skill **notion-map** (`.claude/skills/notion-map/SKILL.md`) instead of searching from scratch.
4. **Code: read `CODEMAP.md` first** (every file → its purpose, generated, kept fresh by a test), then open only the file
   you need. Changing `desktop/`: follow the skill **desktop-change** (`.claude/skills/desktop-change/SKILL.md`): the fast
   edit → check → push loop and the traps that caused real bugs. Screens: skill **ui-look-and-feel**.
5. Humans and agents alike: [CONTRIBUTING.md](CONTRIBUTING.md) (the change loop, where things go) and
   [RELEASE.md](RELEASE.md) (pre-releases, `tools/release-stable.sh`, what updates on a friend's side).
6. New file: start it with a one-line comment (docstring in Python) saying what it's for; `node desktop/scripts/codemap.mjs`
   then updates `CODEMAP.md`.

## Working rules
- Code changes happen in a git worktree on their own branch (see AGENTS.md → Working with git); other agents work on this repo at the same time.
- After each change: tests pass → commit → push to `main` → update Notion (hub current state, Run Log, Technical Reference; Decision Log when a decision changes; Handoff "Current state" / "Open threads" at the end of a session).
- Wrong data is a bug: fix the root cause in the code first (with a regression test) and push; repair Notion only after, preferably by re-running the fixed code (reset its state, run it again), hand edits only for what code can't redo.
- Ask before spending money on AI (new model or large re-runs); show measured cost.
- **Every fix works for any user, through the Desktop App.** When something is set up, repaired or unblocked by hand
  (a terminal command, a Keychain read, `gh secret set`, a Notion edit), that was a product bug: build the same step
  into the app (automatic where possible, else one clear button or wizard step) and test it, then say which. Nothing may
  depend on the owner's machine, CLI tools or access. Example: Always on now copies the Google sign-in to the user's
  GitHub repo itself (`desktop/lib/google-keys.js`), after it was once set with `gh secret set` by hand.
- Never auto-apply to jobs: the application kit drafts, the owner submits. Never scrape LinkedIn, Glassdoor, levels.fyi or Reddit; use public APIs and job-feed endpoints only.
- Secrets live in the macOS Keychain (`job-pilotto.*`), GitHub secrets and Cloudflare Worker secrets — never in code or Notion.

## Superpowers plugin (obra/superpowers, adopted 29 Sep 2026)
Use its skills for the change loop: brainstorming → writing-plans → test-driven-development → verification-before-completion,
plus systematic-debugging for bugs. This repo's rules win where they differ:
- Worktrees: `tools/worktree.sh <topic>` (`.claude/worktrees/`), not `.worktrees/`.
- Finish: rebase on `origin/main`, tests, push to `main` (no local merge, no PR unless asked), then Notion.
- Small changes (a label, a style, a one-file fix): skip brainstorming and plans; edit → one suite → push.
- Models per task: subagents `explorer` (Haiku, read-only look-ups) and `implementer` (Sonnet, one approved plan step) in `.claude/agents/`; design, unknown bugs and multi-area changes stay in the main session.
- Specs/plans go in `docs/superpowers/`; link big ones from the Notion Decision Log, don't copy them there.
- When to use which (from the 24–29 Sep Run Log, where the rework came from):
  - UI from an owner mockup or request: brainstorming first; confirm layout + behaviour in one message before code
    (Profile moved and back, Settings saving changed twice, Actions redesigned 3× on 28 Sep).
  - A bug the owner saw: systematic-debugging, root cause + failing test before any fix (Notion 429s took 3 rounds).
  - Big features (Always on, migrations, Apply with Claude): a spec in `docs/superpowers/specs/` with a
    "Data ownership" section (Notion vs cache) before code.
  - "Done" = tests pass + the suite as CI runs it
    (`JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs python3 -m unittest discover -s tests`, desktop `npm ci` with dev deps).
- Weekly self-review (`.github/workflows/weekly-self-review.yml`, Sun evening): Claude reads the week's commits/CI/issues and
  opens a `self-review/<date>` PR editing these rules or skills. Proposals only: the owner merges.

## Data ownership: Notion is the source of truth (one copy of everything)
Data is Notion-first. Before adding any stored field, file, setting or table, decide where it lives:
- **Notion** — anything the user reads, edits, or would want on another device: statuses, run results,
  profile/answers, open questions, contact details, learned form notes, search settings, transcripts.
  The code reads it from Notion; it never keeps a second editable copy.
- **The Mac / runner** — only keys (encrypted), large files and caches that can be
  deleted and rebuilt from Notion or a crawl (`jobs.sqlite`, `config/*.json` as the cache of ⚙️ Search
  settings, `runs.json`). A cache is refreshed *from* Notion; writes go to Notion first, and if Notion
  refuses, nothing changes locally and the user is told.
- Files: the CV (every version, Profile → "📎 CV") and tailored CVs (Applications → "Tailored CV") are uploaded to
  Notion too (`desktop/lib/files.js`, ≤ 5 MB on Notion's free plan). What's too big (call recordings) is only on
  the Mac and in the weekly automatic backup (`desktop/lib/backup.js`: iCloud Drive or Documents, last 4, no keys).
- Notion is required in the Desktop App (decided 28 Sep 2026): the setup can't finish without it, and a
  set-up app without a Notion connection opens the Notion step. There is no Mac-only mode.
- No new "local fallback" copies of user data, and **no cache-only fields**: if a screen or command needs a
  field, it is a Notion column. A feature that needs a new database, column or page adds it to Notion *and* to
  `config/notion_schema.json` (`tools/notion_schema.py snapshot`, or edit it), so every workspace can be rebuilt
  and repaired (`desktop/lib/schema.js`, at connect and start-up). Existing rows get the value backfilled.
  `tests/test_notion_schema_coverage.py` fails when the code uses a column the schema lacks, and
  `tests/test_notion_docs_coverage.py` when a schema column isn't in `docs/notion-schema.md`: after adding one, run
  `python3 tools/notion_schema.py docs` and write its Notes. (`config/notion_template.json` lists only the columns
  checked at connect; don't add optional ones there, the app adds them from the schema.)
- The desktop Jobs list is built from Notion (Job Matches + Applications, `Tracker.notion_jobs`), with Notion's
  fields only; the cache is kept in step and only adds jobs a search couldn't write to Notion yet (marked).
- Moving existing local data to Notion: add a step to `desktop/lib/migrate.js` (delete the local copy only
  after Notion confirmed it has it) and a test.
- Every run (search, Gmail check, kit, review, insight, report, find employers) leaves a row in ⏱️ Search runs,
  wherever it ran (the Mac, the user's GitHub repo, a Telegram button): opened at the start (Status Running,
  `cron_runs.begin`, with a ⏳ progress line in Summary), completed at the end with its report, its **Result**
  (the message it sent or showed) and a **Technical log** toggle. That row is the one run history: the app's
  Recent activity (`desktop/lib/run-history.js`) and Telegram /status read it; `runs.json` is only a cache.
- Background jobs run in exactly one place: the user's GitHub repo when **Always on** is on (the old "Keep working while my Mac is off")
  (app buttons, Prepare, interview review and the first search included), else this Mac. Only what needs the Mac
  (recording/transcribing, Apply with Claude, form filling, Google sign-in) or an instant answer runs locally.

## Desktop UI: one design system
- **The window is one module per page** (`desktop/renderer/pages/`: focus, jobs, sessions, session-needs, session-log,
  strategy, settings, interviews, activity…); `renderer/app.js` only runs each page's `init()` in order. Helpers every
  page uses are in `pages/core.js`; state more than one page *reassigns* lives on `shared` (`pages/shared.js`), since an
  imported binding is read-only. Put logic that can be tested without a window in its own small module
  (`renderer/session-message.js`, `session-state.js`, `wheel.js`) with a test in `desktop/test/`.
- `electron .` works in any worktree: the entry `desktop/start.js` builds `shared/` when it's missing, and a test run
  (`JOB_PILOTTO_SMOKE…`) that can't start prints why and quits: no crash dialog on the owner's screen.
- **Checking a UI change:** `npm run shot -- <page>` (one screen, ~5 s) or `--eval "…" --no-picture` to read the
  window's state (`window.__jp`) as JSON; `--reload` tests after ⌘R. The full reference set (`npm run ui-shots`)
  is only for big changes, about daily, or when the owner asks (details: skill `ui-look-and-feel`).
- **Before building or changing any screen, read the skill `ui-look-and-feel`** (`.claude/skills/ui-look-and-feel/SKILL.md`):
  the reference screenshots (`desktop/docs/ui/`, refreshed with `npm run ui-shots`), the page and card patterns the
  owner approved, and how to render your change in demo mode and look at it before saying it's done.
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
- Python package `src/` (run with `python -m src <check|scout|discover|feeds|enrich>`; `check` = the jobs check, also still `daily`; `scout` = Find new employers): `daily.py` orchestrates a run; `digest.py` ranking/rotation/paging/layout/buttons; `telegram.py` sending; `store.py` SQLite; `scout.py` source scout; `paths.py` repo paths; `features.py` optional-feature registry and the `JOB_PILOTTO_DISABLE` switch (only the crawl + digest core is required; new features must be optional, on when their keys exist, and listed there).
- `src/sources/` (`ats.py` feed adapters, `feeds.py` employer-feed crawl, `boards.py` jobs.ch/TechTree), `src/ai/` (`enrich.py` stage 1 Haiku 4.5, `score.py` stage 2 Sonnet 5, `kit.py` application kit Sonnet 5 on 📝 Prepare or auto-drafted, `apply_batch.py` queues kits into the ChatGPT/Codex desktop app, `insights.py` daily insight + Monday weekly report: code stats + Sonnet 5 → Telegram and 💡 Insights, `interviews.py` recording/transcript/notes → 🎤 Interviews rows (the app saves transcripts there, linked to the job; Notion is the database) and their review, `transcribe.py` local audio → transcript with speakers (optional add-on `requirements-transcribe.txt`: sherpa-onnx with Silero VAD, Parakeet-TDT v2 English, pyannote + 3D-Speaker ERes2Net), `mail.py` Gmail + Calendar → events/Stage/Next interview/prep messages; client in `src/sources/google.py`; `opportunity.py` a recruiter's message (Gmail "Recruiter outreach", Telegram `/add <message>` or a forward, the app's Jobs → Recruiter message) → Applications row at Stage Recruiter lead; `inbox.py` "log anything": a pasted message or screenshot (bot photo/forward/`/add <text>`, the app's Log box with "Which job?") → matched against Notion's jobs (Claude + `same_job` fallback) → that job updated, or a new row; screenshot uploaded to the job's page; `added.py` jobs added by hand or from a message/email get what a found job gets: stage 1 facts, stage 2 fit score, a Job Matches row and the fit columns on Applications, before the record is frozen; LinkedIn/Glassdoor/Indeed pages are never fetched (`ledger.NO_FETCH`), the title/company/text come from the user), `src/notion/` (`client.py` Notion API, `matches.py` Job Matches sync, `ledger.py` application record frozen at Applied + 📈 Application Events outcome history + scheduled sync/no-response rule, `funnel.py` funnel conversion + step to improve → 🎯 Pipeline page, no AI).
- `config/` holds editable settings: `preferences.json`, `sources.json`, `scout_seeds.json`.
- `desktop/lib/interviews.js` + the app's Interviews page: records (mic left, call's audio right), keeps only drafts and recordings on the Mac, saves/lists/relinks/reviews rows in Notion 🎤 Interviews. Recording needs the consent box ticked each time.
- **Product vs personal.** Product (shared, the owner's Cloudflare account, subdomain `jobpilotto`): one worker `www` from `site/` → https://www.jobpilotto.workers.dev — website, Pro waitlist (KV), Notion sign-in, and the app's form reports (`/report/fill-failure`, reusing `worker/src/report.js`; secrets `GITHUB_TOKEN`, `REPORT_TOKEN`). Personal (per user, set up in the desktop app): their Telegram bot and their scheduled runs (their private GitHub repo). Nothing in the code is tied to one Telegram bot.
- `worker/` is the Telegram bot's code (commands and buttons): the app runs it locally with long polling (`desktop/lib/telegram.js`); as a Cloudflare worker it's a per-user deployment for buttons while the computer is off: `desktop/lib/telegram-cloud.js` uploads `desktop/shared/bot-worker.js` (esbuild bundle from `scripts/stage.mjs`) as `job-pilotto-bot` to the user's own Cloudflare account with their token (Settings → Always on → Telegram buttons, always on), sets the webhook, and the app stops long polling (`settings.telegramCloud`). Not deployed by the owner; `npm test`.
- Workflows: `.github/workflows/daily.yml`, `scout.yml`, `mail.yml` are the engine: reusable (`workflow_call`) and manual, with no schedule, so this public repo never runs on anyone's data. The schedules (daily every 4 h, scout daily, mail 3x a day and 5 min after applying) live in each user's private repo, from `templates/github-actions/` (the owner's: `GarryOne/job-pilotto-private`).
- `desktop/lib/github.js`: the app's **Always on** (runs on GitHub, even when the Mac is off), as a GitHub App installed on one repo only: the user creates `<user>/job-pilotto-private` from the public template `GarryOne/job-pilotto-starter` (published from `templates/github-actions` by `tools/publish-starter.sh`), installs the app on it, approves a device-flow code; the app then commits the templates + the user's `config/search.json`/`preferences.json` (overlaid on the defaults by the engine), sets sealed secrets and variables; while on, Telegram buttons dispatch there and the Jobs list comes from the latest `job-pilotto-jobs-db` artifact.
- Apply with Claude (Desktop App job row, recommended when Claude Code is installed and Notion connected): `desktop/lib/apply.js` `claudeOne` → `desktop/lib/claude-session.js` (Mac: Terminal; Windows: a console window via `start`, needs Git for Windows), one `claude --chrome --permission-mode bypassPermissions` session per job, started in the app's pipeline folder with the skill bundled (`stage.mjs` copies `.claude/skills/apply-to-job`), after a one-time consent (`settings.claudeConsent`, Settings → Apply with Claude); it follows job board → employer site → sign-up → form ("Reaching the form" in the apply-to-job skill). Employer passwords go through `python3 -m src.ai.passwords` into the Keychain / Windows Credential Manager (`job-pilotto.<host>.password`); the session's `python3` is a shim to the app's Python; confirmation emails are read with `python -m src.sources.google verify` (Gmail read-only, connected in Settings → Gmail and Calendar). Never Submit.
- Form-filling improvement loop: every extension fill is logged to Agent Runs (field table + debug JSON); `tools/fill-failures.py` groups what was left; the **improve-filling** skill (`.claude/skills/improve-filling/SKILL.md`) turns the top failures into tested fixes. Data gaps go to the app's "Answer once" list.
- Notion IDs have no defaults in code: they come from the environment (`.env`, repository variables, or the Desktop App).
- **The terminal follows the Desktop App** (`src/paths.py` `follow_app`): when the app is set up on this computer,
  terminal runs use its Notion IDs and its `data/` + `config/` folders (one job cache); a line on stderr says so.
  `.env` NOTION_* IDs of another workspace (e.g. the test one) switch that off for the run, never mixed.
  `JOB_PILOTTO_FOLLOW_APP=0` turns it off. Searches from the app and the terminal take turns (`run_lock`).

## Tests
`python3 -m unittest discover -s tests`, `cd worker && npm test` and `cd desktop && npm test`.
A Claude Code hook (`.claude/settings.json` → `tools/pre-push-check.sh`) runs all of them, plus the
Python suite without credentials as CI sees it, before every `git push` and blocks the push if one
fails, so only green builds reach GitHub. It also lints the workflow files (`actionlint`, with
shellcheck on each `run:` script) and, when a `package.json` or lock file changed, proves `npm ci`
works from scratch, the two CI-only failure classes the tests can't see. Two more guards: `build.yml` must
install dev dependencies like a developer does (an `--omit=dev` there once hid a missing esbuild from this hook
and left 8 commits red), and a push is blocked while the latest `build` run on main is red; push the fix itself
with `CI_RED_OK=1 git push ...`.
