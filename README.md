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

## Day-to-day use

**The baseline runs itself — there's nothing to trigger.** Every 4 hours GitHub Actions crawls,
scores, and (if you've turned it on) drafts kits for your best new matches, and Telegram messages
you the result. If nothing new and good enough showed up, `scheduled` mode stays quiet rather than
spamming you. This part needs zero daily action from you.

What you actually *do*, day to day, is a mix of two habits:

**1. A couple of minutes, most times you check your phone** — read whatever Telegram sent, and tap
buttons under jobs you care about: **⭐ Save** to keep something for later, **❌ Dismiss** to hide
noise (this also tunes future scoring), **✅ Applied** if you applied outside this system, or
**📝 Prepare** on a good job that didn't get an automatic kit. This is the entire "daily" loop for
most people — no commands, just reacting to what arrives.

**2. A batch session every few days, when you're ready to actually apply** (this is the "I'd spawn
job application automations" part of your question) — on your laptop:
```sh
tools/apply-batch.sh --max 5
```
This looks at everything sitting **Saved with a kit already on it** (built up by habit #1 and by
auto-drafting) and queues each one into its own Codex chat, already filled in, stopped before
Submit. You then spend that session reviewing each chat and clicking Submit — the actual "applying"
still takes your attention, but the form-filling and drafting don't. Nothing forces this to happen
on a schedule; you run it whenever you have kits piled up and time to review them.

You can also reach for specific Telegram commands on demand, not as a daily ritual:

| When you want | Send |
|---|---|
| A fresh crawl right now instead of waiting for the next 4-hourly run | `/run` |
| The current ranked list without re-crawling | `/today` |
| What you've applied to and their stage | `/applied` |
| Jobs you starred | `/saved` |
| To find new employer feeds outside the daily scout | `/scout` |
| Whether the last few runs succeeded | `/status` |

**Putting it together, a realistic week looks like:** Telegram pings you a few times a day; you
tap ⭐/❌ on maybe a dozen jobs without leaving the app; a couple of times that week you open your
laptop, run `apply-batch.sh`, review 3-5 filled forms over coffee, submit the good ones, and mark
them applied. The system never applies on its own initiative — it just makes sure that by the time
you sit down to apply, the tedious part (finding the posting, writing the letter, answering the
same 15 form questions again) is already done.

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

**`config/search.json` is what makes this a general-purpose job search, not an SRE-in-Switzerland
one.** It holds every role, location and tech-stack keyword the code uses to decide what counts as
a relevant job and where: `role_keywords` (job titles you want), `board_discovery_keywords`
(broader terms for jobs.ch discovery), `jobs_board_search_queries` (the literal search terms run
against jobs.ch), `quality_stack_keywords` (tech terms the scout uses to judge a new employer feed),
and `locations.{top_tier,country_wide,abroad}` / `remote_excluded_regions` (your preferred places
and which "remote" postings don't actually include you). Values are regex fragments (e.g. `"z[uü]rich"`
matches both spellings, `"\\bsre\\b"` avoids matching inside another word) — copy that style when
adding your own. A frontend developer targeting Berlin, for example, would set `role_keywords` to
`["frontend", "react", "\\bui\\b", "web developer"]` and `locations.top_tier` to `["berlin"]`.

For the optional local tooling: `SRE_WATCH_CV_PATH` points `tools/apply-batch.sh` at your CV
(defaults to `~/Documents/CV.pdf` — the maintainer's own file; set this
to yours).

## How the application automation works

Drafting and filling can be automated end to end; **submitting never is.** The full pipeline, in
order:

1. **A kit gets drafted.** For your best-scored new matches (score ≥ `SRE_WATCH_AUTO_KIT_MIN_SCORE`,
   up to `SRE_WATCH_AUTO_KIT_MAX` per crawl) this happens automatically after AI stage 2, with no
   action from you. For any other job, tap **📝 Prepare application kit** under it in Telegram, or
   run `python -m src daily --mode prepare --job <job URL>`.
   - Claude reads the employer's real application form where it can (currently Greenhouse's public
     API — other ATS platforms get a best-guess set of likely questions instead), plus your Profile
     and Application Answers pages, and drafts a cover letter and one answer per question.
   - Anything it isn't confident about is drafted anyway but flagged ❓ for your review, never
     stated as settled fact — sponsorship requirements, salary, language, and anything your
     Application Answers page marks ❓ itself.
   - The kit is saved as a "📝 Application kit" section on the job's Notion Applications row (JSON
     included, for the next step to read), and sent to Telegram as copyable blocks. The row moves
     to Stage **Saved** if it wasn't tracked yet. Cost is roughly USD 0.04-0.07 per kit.
2. **The kit gets filled into a real form.** Two ways to do this, both stop before Submit:
   - **Live, with an AI coding assistant driving a real browser** — ask Claude (with
     [Claude in Chrome](https://claude.ai/chrome)) or another browser-capable assistant to fill the
     job from its kit; see `.claude/skills/apply-to-job/SKILL.md` for the exact steps and
     per-platform notes (it's written to be readable by any agent, not just Claude).
   - **Queued into the ChatGPT/Codex desktop app** (macOS only) — `tools/apply-batch.sh` reads
     every Saved job with a kit, builds a plain-text prompt from it, and pastes-and-sends it into a
     new Codex chat per job via `tools/send-to-chatgpt.sh`. Codex fills the form in its own
     embedded browser and stops on its own approval gate. Right after queueing, that job's Stage
     moves to **Applying** so a second run never queues it twice.
3. **You review and click Submit yourself**, in every case, in every tool. Nothing in this project
   can do that step for you — that's deliberate, not a current limitation.
4. **You mark it applied**: tap ✅ under the job in Telegram, or
   `gh workflow run daily.yml -f mode=apply -f job=<job URL> -f action=applied`.

Two safety rules worth knowing if you extend this: legal-acknowledgment checkboxes ("I agree
to...", privacy notices) are always left for you to check yourself, even when the kit has an
answer for the question — and nothing here should ever be pointed at a "click Submit" action
without a human confirming first. See `.claude/skills/apply-to-job/SKILL.md`'s Log for what's been
learned running this against real forms, and `AGENTS.md` for the same rules aimed at any agent
working in this repo.

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
  search.json        role/location/tech-stack keywords — what "relevant" means, edit this first
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
7. Fill in your Profile and Application Answers pages in Notion; edit `config/search.json` to your
   own role/location/tech keywords, and `config/preferences.json`, `config/sources.json` and
   `config/scout_seeds.json` to your own languages and target employers.

## Set it up with an AI coding agent

The steps above are written for a person, but an AI coding agent (Claude Code, Codex CLI, or
similar, with shell and file access) can do most of the mechanical work — creating accounts,
logging into third-party services, and sharing a Notion page with an integration are the parts
that genuinely need you, since no agent can click through someone else's OAuth consent screen or
sign up for an account on your behalf. A good agent will pause and ask for those; don't expect (or
want) one that pretends it can skip them. Paste this to get started:

```
Clone https://github.com/GarryOne/sre-watch (or my fork of it) into this directory. Read README.md,
docs/notion-schema.md, and AGENTS.md in full before doing anything else.

Then help me set this up for myself, step by step:

1. Tell me exactly which accounts I need to create or log into myself (Telegram bot via BotFather,
   Cloudflare, Notion integration, Anthropic API key) and what each one gives you (a token, an ID) —
   pause and wait for me to paste each one back to you rather than guessing or inventing a value.
2. Once I've shared my Notion integration's access, create the databases and pages listed in
   docs/notion-schema.md for me via the Notion API, with the exact property names and types it
   specifies. Tell me the resulting page/database IDs.
3. Set the GitHub secrets and variables README.md's Configuration section lists, using the `gh`
   CLI against my fork, from the values I've given you. Never print a secret back to me or commit
   one to a file.
4. Deploy the Cloudflare Worker (`worker/setup.sh`) once I've logged in via `wrangler`.
5. Ask me for my CV and job-search preferences, and draft the Profile and Application Answers
   Notion pages for me in the structure docs/notion-schema.md describes — mark anything I haven't
   given you a clear answer for with ❓, don't invent one. Also help me edit config/search.json to my
   own role, location and tech-stack keywords, and config/preferences.json, config/sources.json and
   config/scout_seeds.json to my own languages and target employers.
6. Run the test suites (python3 -m unittest discover -s tests, and cd worker && npm test) and fix
   anything that fails before calling this done.
7. Trigger one real run (mode `run`) and show me what came back in Telegram.

Follow every rule in AGENTS.md, especially: never submit a job application on my behalf, ask before
any step that spends money on AI model calls, and never write my personal data (email, phone,
answers) into any file that gets committed to git.
```

## License and use

Personal-use project; no warranty. It only reads public job-board and employer-feed APIs — no
scraping of sites whose terms forbid it (LinkedIn, Glassdoor, levels.fyi, Reddit are deliberately
excluded). Never configure it to submit applications automatically; every path that fills a form
stops before Submit by design, and that's meant to stay true for any fork too.
