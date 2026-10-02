# Job Pilotto — architecture

Read this once at the start of a session. Then open `CODEMAP.md` for the file the task names. Workflow detail, only if the task touches one: `docs/HOW-IT-RUNS.md`.

Job Pilotto is a personal job-search system: it finds jobs, scores them, tracks them in Notion, and can fill application forms. It never clicks Submit.

The public repo at `~/job-pilotto` is the engine plus the Mac/Windows app. A user's private GitHub repo only holds schedules and secrets, and calls this engine. Prompts and the product brain live in the private sibling `~/job-pilotto-internal`.

## How a job moves

```text
sources → crawl → SQLite cache → AI → Notion + Telegram → you submit → learn
```

1. **Discover.** Employer feeds (Greenhouse, Lever, Ashby, Workable, and others) plus jobs.ch and TechTree. A shared employer index is downloaded at most once a day (`GET /api/index`); a run crawls only feeds that match the user's places. LinkedIn, Glassdoor, levels.fyi, and Reddit are never scraped.
2. **Cache.** `data/jobs.sqlite` remembers what was already seen. It is a cache, not the record.
3. **Read and rank.** Stage 1 (Haiku) extracts facts from the posting. Stage 2 (Sonnet) scores fit against the Notion profile. Top matches get an application kit (cover letter and form answers).
4. **Deliver.** A ranked Telegram digest, plus rows in Notion. Every run writes a row in Search runs.
5. **Act, locally.** The desktop app and the Chrome extension fill the form. The owner reviews and submits. How an application starts, who fills, and what is still open: [docs/apply-flow.md](apply-flow.md).
6. **Learn.** Read-only Gmail and Calendar update stages. Interview recordings are transcribed on the machine. A daily insight and a Monday report go back to Telegram.

The core crawl and printed digest need no accounts. Everything else turns on when its keys exist, and `JOB_PILOTTO_DISABLE` can switch a feature off. The registry is `src/features.py`.

## Five runtimes, one engine

| Piece | Path | Role |
|---|---|---|
| Python engine | `src/` | The pipeline. Entry: `python -m src <check\|scout\|discover\|feeds\|enrich\|doctor>`. `src/daily.py` orchestrates a jobs check (`daily` is the old name). |
| Desktop app | `desktop/` | Electron cockpit (v0.4.0-alpha). `start.js` → `main.js`. The window is one module per page under `desktop/renderer/pages/`. `desktop/lib/pipeline.js` shells out to the same Python engine. |
| Chrome extension | private repo `GarryOne/job-pilotto-extension` | Fills a form from the kit. Talks to the app on `127.0.0.1` (`desktop/lib/server.js`). Never submits. Delivered by the website to licensed users and trials: published by that repo's CI (`site/src/extension-pack.js`), downloaded and kept updated by the app (`desktop/lib/extension-pack.js`). Dev: `JOB_PILOTTO_EXTENSION_DIR=<your checkout>`. |
| Website worker | `site/` | One Cloudflare worker: the site, Notion sign-in, the employer index, telemetry, license/trial, fill-failure intake. |
| Telegram bot | `worker/` | Commands and buttons. The app long-polls it locally. "Always on" uploads a bundle to the user's own Cloudflare account so buttons work while the Mac is off. |

`desktop/lib/github.js` is the "Always on" path. The user creates `<user>/job-pilotto-private` from a public starter. That repo's workflows (`templates/github-actions/`, scheduled every 4 hours for jobs, optional scout, mail three times a day) call the reusable workflows in this repo: `daily.yml`, `scout.yml`, `mail.yml`. Those workflows have no schedule of their own, so the public repo never runs on anyone's data.

What stays on the Mac: recording, transcription, Apply with Claude, form filling, and Google sign-in.

## Where the code sits

```text
src/
  daily.py, digest.py, store.py, scout.py, paths.py, features.py
  sources/     ats.py (feed adapters), feeds.py, boards.py, google.py, google_jobs.py
  ai/          enrich, score, kit, mail, inbox, interviews, prep, insights, budget
  notion/      client, matches, ledger, cron_runs, funnel, search_settings
desktop/
  main.js, preload.cjs          main process; the window has no Node and no secrets
  lib/                          pipeline, Notion, GitHub, Telegram, apply, schema, logs
  renderer/pages/               focus, jobs, sessions, strategy, settings, interviews, activity
config/                         search.json, sources.json, notion_schema.json (workspace as code)
tools/                          worktrees, form fast-path, schema snapshot, release
.github/workflows/              CI, desktop release, site deploy, and the user-called engine workflows
```

`CODEMAP.md` is generated from each file's first comment and kept fresh by a test. Read that before opening a file.

## Data ownership

Notion is the source of truth for anything the user reads or would want on another device: applications, matches, profile, answers, search settings, run history, transcripts.

The Mac keeps only keys (Keychain), large files, and rebuildable caches (`jobs.sqlite`, `config/*.json`, `runs.json`). Writes go to Notion first. If Notion refuses, nothing changes locally.

Two Notion lists stay distinct. **Job Matches** is what a search found and scored. **Applications** is every job the user pursues, including ones added by hand or from a recruiter.

The employer index is product data on the website, not user data. Nothing about the user is sent to fetch it.

## Product loops around the engine

User runs and product runs are separate. The product side, described in `docs/HOW-IT-RUNS.md`, is a closed loop: apps send scrubbed telemetry and form-structure reports, those become GitHub issues, a daily job asks Claude for a tested fix on a branch, and the owner merges. A canary that stays healthy for 48 hours can become the stable desktop release. A weekly self-review may edit the rules, again only as a pull request.

## Constraints that shape the design

- Submit is never automated. Legal checkboxes stay with the owner.
- AI spend is gated. New models or large re-runs need a yes first. A monthly budget pauses optional AI steps.
- Several agents share this checkout and push to `main`. Code changes go in a worktree (`tools/worktree.sh`), then a normal fast-forward push. No force-push.
- Tests are three suites: `python3 -m unittest discover -s tests`, `cd worker && npm test`, `cd desktop && npm test`.
