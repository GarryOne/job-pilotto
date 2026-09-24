# SRE Watch

Job-search automation for SRE / platform / DevOps roles. Fork it, point it at your own places,
languages and CV, and it crawls job boards and employer feeds every 4 hours, has Claude score each
posting against your profile, drafts a cover letter and form answers for your best matches, and
sends a ranked digest to Telegram. Applications are tracked in Notion. **It never submits an
application on your behalf** — drafting and filling can be automated; clicking Submit always stays
with you.

```
Job boards + employer feeds ──▶ crawl (GitHub Actions, every 4 h)
                                  │  SQLite state in the Actions cache
                                  ▼
                   AI stage 1: facts (Claude Haiku 4.5)
                   AI stage 2: fit score vs your Profile (Claude Sonnet 5)
                   AI stage 3: application kit for your best matches (Claude Sonnet 5)
                                  │
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                     ▼
   Telegram digest (top 10)   Notion: Job Matches,   tools/apply-batch.sh
   with buttons               Applications, Profile   queues kits into an
             │                                         AI browser agent
             ▼
   Cloudflare Worker ── commands and buttons ──▶ GitHub Actions runs
```

## What you get

- **Telegram digest**: top 10 jobs per message, best matches first and rotating between digests.
  Each job shows its fit score, company, place, seniority, work mode, language and salary signals,
  and a one-line reason. Tap a job number for **✅ Applied**, **⭐ Save**, **❌ Dismiss** or
  **📝 Prepare application kit**; **➕ Next 10** pages through the list.
- **Commands**: `/run` (crawl now), `/today` (current list), `/applied`, `/saved`, `/scout` (find
  new employer feeds), `/status`, `/help`.
- **Filters**: jobs requiring a language you don't speak are hidden; only roles in your preferred
  places (or remote) are kept; applied and dismissed jobs never return; jobs not seen for 7 days
  are closed.
- **Source scout**: once a day it checks candidate employers (seed companies first, then Hacker
  News "Who is hiring?", open company lists and jobs.ch employers) for a public job feed, scores
  each feed's quality and adds the useful ones to the crawl.
- **Application kits**: for your best-scored new matches (configurable threshold), Claude drafts a
  tailored cover letter and one answer per real form question (read from the employer's own
  application form where supported), flags anything it isn't sure about instead of guessing, and
  saves it to the job's Notion row. Available on demand too, via the 📝 Prepare button.
- **Queueing kits into an AI browser agent**: `tools/apply-batch.sh` (macOS only) pastes each ready
  kit into a new ChatGPT/Codex desktop chat, which fills the real form and stops before Submit.
  You review and submit every application yourself, in every case.
- **Notion**: Job Matches (every scored job), Applications — Job Tracker, Employers & Sources, and
  the Profile and Application Answers pages the scorer and kit drafter read.

## Prerequisites

**Required — the core pipeline runs entirely in the cloud, any OS:**

1. A **GitHub account** — fork this repo; Actions must stay enabled.
2. A **Telegram account and bot** — message [@BotFather](https://t.me/BotFather) to create one
   (`TELEGRAM_BOT_TOKEN`); message your new bot once to get your chat ID (`TELEGRAM_CHAT_ID`).
3. A **Cloudflare account** (free tier) — hosts the Worker that turns Telegram commands and button
   taps into GitHub Actions runs. You'll need `npx wrangler` and a GitHub fine-grained personal
   access token (Actions: read + write on your fork) for the Worker to use.
4. A **Notion account and integration** (`NOTION_TOKEN`), with your own copies of the databases and
   pages in **[docs/notion-schema.md](docs/notion-schema.md)** — the exact property names and
   types to create, so you don't have to reverse-engineer them from the source code. In short:
   an Applications database, a Job Matches database, a Profile page, an Application Answers page,
   and (optional) an Employers & Sources database.
5. An **Anthropic account and API key** (`ANTHROPIC_API_KEY`) — pay-as-you-go; powers fact
   extraction, fit scoring and kit drafting. Skip it and you still get a plain crawler + digest,
   with no scoring or drafting.
6. **Your own CV and profile facts.** There's no way around this being manual — it's what makes
   the scoring and drafting personal to you.

**Optional — local "apply" tooling, macOS only:**

7. A **Mac**, since `tools/send-to-chatgpt.sh` and `tools/apply-batch.sh` use `osascript`/System
   Events.
8. The **ChatGPT/Codex desktop app**, signed in, with your terminal app granted **Accessibility**
   permission (System Settings → Privacy & Security → Accessibility).
9. **[Claude in Chrome](https://claude.ai/chrome)**, if you'd rather fill forms live with Claude
   instead of (or alongside) Codex — see `.claude/skills/apply-to-job/SKILL.md`.

None of group two is required for the core pipeline; it only matters if you want the same
"queue kits into an AI browser agent" workflow described above.

## Configuration

**GitHub repository secrets** (Settings → Secrets and variables → Actions):
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NOTION_TOKEN`, `ANTHROPIC_API_KEY`.

**GitHub repository variables**, all optional, everything is off by default:

| Variable | Effect |
|---|---|
| `NOTION_APPLICATIONS_DB` | your Applications database ID |
| `NOTION_PROFILE_PAGE_ID` | your Profile page ID |
| `NOTION_MATCHES_DB` | your Job Matches database ID |
| `NOTION_ANSWERS_PAGE_ID` | your Application Answers page ID |
| `NOTION_EMPLOYERS_DB` | your Employers & Sources database ID (optional — the crawler falls back to `config/sources.json` without it) |
| `SRE_WATCH_ENRICH_MODEL` | e.g. `claude-haiku-4-5` — turns on AI stage 1 |
| `SRE_WATCH_SCORE_MODEL` | e.g. `claude-sonnet-5` — turns on AI stage 2 |
| `SRE_WATCH_KIT_MODEL` | model for 📝 Prepare (defaults to `claude-sonnet-5` if unset) |
| `SRE_WATCH_AUTO_KIT_MAX` | auto-draft kits for up to N best new matches per crawl (0/unset = off) |
| `SRE_WATCH_AUTO_KIT_MIN_SCORE` | minimum fit score to qualify (default 50) |

Delete `SRE_WATCH_ENRICH_MODEL`/`SRE_WATCH_SCORE_MODEL` at any time to stop all AI spending.

`config/preferences.json`, `config/sources.json` and `config/scout_seeds.json` hold your hard
filters, always-crawled employer feeds and scout candidate companies — edit these to your own
target places, languages and employers.

For the optional local tooling: `SRE_WATCH_CV_PATH` points `tools/apply-batch.sh` at your CV
(defaults to `~/Documents/CV.pdf` — the maintainer's own file; set this
to yours).

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
    kit.py           AI stage 3: application kit (cover letter + form answers), on demand or auto
    apply_batch.py   queues ready kits into the ChatGPT/Codex desktop app
  notion/
    client.py        Notion API: Applications, Profile, Job Matches, Application Answers
    matches.py       mirror of scored jobs into Notion Job Matches
config/
  preferences.json   hard filters (disqualifying languages)
  sources.json       employer feeds always crawled
  scout_seeds.json   candidate employers for the scout (Tier 1, regions)
worker/              Cloudflare Worker for the Telegram bot (commands, buttons)
tools/
  send-to-chatgpt.sh pastes (and optionally sends) a prompt into the ChatGPT/Codex desktop app
  apply-batch.sh     queues every ready application kit into a new chat, one per job
.claude/skills/      apply-to-job (how to fill a form from a kit) and notion-map (page/DB index)
AGENTS.md            instructions for any agent (Claude, Codex, or other) working in this repo
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
tools/apply-batch.sh --dry-run        # preview what would be queued into Codex
```

`daily` modes: `scheduled` (sends only when there are new jobs), `run` (crawl + always send),
`today` (no board crawl), `more` (next page of a digest), `apply` (record ✅ / ⭐ / ❌ in Notion),
`prepare` (draft an application kit for one job).

## Tests

```sh
python3 -m unittest discover -s tests
cd worker && npm test
```

## First-time setup

1. Fork the repo, clone it.
2. Create your Notion integration and the databases/pages in
   [docs/notion-schema.md](docs/notion-schema.md); share each with the integration; note their IDs.
3. Create your Telegram bot; message it once to get your chat ID.
4. Set the GitHub secrets and variables listed above.
5. Deploy the Worker: `cd worker && ./setup.sh` (creates Worker secrets, sets the Telegram webhook
   and command menu — needs a Cloudflare account logged in via `wrangler`).
6. Trigger a first run by hand: Actions tab → `Daily job discovery` → Run workflow → mode `run`, or
   send `/run` to your bot once the webhook is live.
7. Fill in your Profile and Application Answers pages in Notion; edit `config/preferences.json`,
   `config/sources.json` and `config/scout_seeds.json` to your own places, languages and employers.

## License and use

Personal-use project; no warranty. It only reads public job-board and employer-feed APIs — no
scraping of sites whose terms forbid it (LinkedIn, Glassdoor, levels.fyi, Reddit are deliberately
excluded). Never configure it to submit applications automatically; every path that fills a form
stops before Submit by design, and that's meant to stay true for any fork too.
