# Job Pilotto

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
   Telegram digest (top 10)   Notion: Job Matches,   tools/apply-batch-chatgpt.sh
   with buttons               Applications, Profile   queues kits into an
             │                                         AI browser agent
             ▼
   Cloudflare Worker ── commands and buttons ──▶ GitHub Actions runs
```

## What you get

### 🔎 Finding jobs
- 🕷️ **Crawls every 4 hours** on GitHub Actions: jobs.ch, TechTree and employer feeds (Greenhouse,
  Lever, Ashby, Workable, Recruitee, Personio, SmartRecruiters, Amazon, Netflix).
- 🛰️ **Source scout**: once a day it checks new candidate employers (seed companies, Hacker News
  "Who is hiring?", open company lists, jobs.ch employers) for a public job feed, scores its quality
  and adds the useful ones to the crawl.
- 🌍 **Filters**: only your preferred places (or remote); jobs requiring a language you don't speak
  are hidden; applied and dismissed jobs never come back; jobs gone for 7 days are closed.

### 🧠 AI that reads every posting
- 🔬 **Stage 1 — facts** (Claude Haiku 4.5): languages, seniority, work mode, salary, recruiter vs
  employer, visa sponsorship — each with a quote from the posting as evidence.
- 🎯 **Stage 2 — fit score** (Claude Sonnet 5): 0–100 against your Notion Profile, a tier (A/B/C)
  and a one-line reason. Edit your Profile and every open job is re-scored.
- 🛂 **Visa badges**: 🔴 when you'd need sponsorship (or the posting rules it out), 🛂 when the
  posting offers it — without lowering the score.
- 📝 **Application kits**: for your best new matches, Claude drafts a short cover letter in your own
  voice and one answer per real form question (read from the employer's form), flags anything it
  isn't sure about instead of guessing, and saves it to the job's Notion row.

### 📬 Telegram
- 📊 **Digest**: top 10 jobs per message, best matches first, rotating between digests, with score,
  company, place, seniority, work mode, language and salary signals.
- 👆 **Buttons**: ✅ Applied · ⭐ Save · ❌ Dismiss · 📝 Prepare application kit · ➕ Next 10.
- ⌨️ **Commands**: `/run`, `/today`, `/applied`, `/saved`, `/scout`, `/status`, `/help`.

### 🤖 Filling applications (macOS)
- 🚀 **Three launchers, one CLI**: ChatGPT desktop, Codex CLI + Playwright, or Claude Code + Claude
  in Chrome — each takes job URLs, `-f jobs.txt` or `--max N` and fills the real form from the kit.
- ⚡ **Fast-path form helpers** (`tools/browser-form-fastpath.js`): map the form once, fill every
  plain field in one call, audit what's missing, click dropdown options by live coordinates.
- 🛡️ **Never submits**: an in-page guard blocks Submit and legal-consent clicks while an agent works;
  you review and click Submit yourself, every time.
- ✅ **Auto-marked applied**: when the confirmation page appears in Chrome, the job moves to Applied
  in Notion by itself, whichever launcher filled it.
- 🔍 **Observable Codex runs**: per-job status, field report and form-fill time.

### 🗂️ Tracking in Notion
- 📋 Job Matches (every scored job), Applications — Job Tracker, Employers & Sources.
- 👤 Profile and Application Answers pages — the single source for the scorer, the kit drafter and
  every form filler. Answer a question once and it's reused on every form.

### 🔐 Private by default
- 🔑 Secrets in the macOS Keychain, GitHub secrets and Cloudflare Worker secrets — never in the repo.
- 🧾 CV, `.env` and run traces stay on your machine (git-ignored).

## How Job Pilotto compares

Job Pilotto is for people who want a self-managed pipeline they control end to end: public job
feeds, explicit location and language filters, evidence-based match scores, reviewable application
kits, Telegram triage, Notion tracking — and browser agents that fill the form but **never submit
it**. Compared from each project's published features and source code, September 2026; this is not
a measured accuracy or success-rate benchmark.

**Legend:** ✅ yes · ⚠️ partial or experimental · ❌ no · ➖ not described in its public docs

| | 🦾 **Job Pilotto** | [JobCopilot.com](https://jobcopilot.com/) | [Job-CoPilot.ai](https://job-copilot.ai/) | [suxrobGM/jobpilot](https://github.com/suxrobGM/jobpilot) | [jsmastery-pro/JobPilot](https://github.com/jsmastery-pro/JobPilot) | [BhairavJShah/JobPilot-AI](https://github.com/BhairavJShah/JobPilot-AI) | [arthurpanhku/job-pilot](https://github.com/arthurpanhku/job-pilot) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 🔓 Open source, self-hosted | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| 🕷️ Automatic job discovery | ✅ | ✅ | ✅ | ➖ | ✅ | ➖ | ✅ |
| 🛰️ Finds new employer feeds by itself | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 🎯 AI fit score against your profile | ✅ | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ |
| 🌍 Location, language and visa filters | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| ✍️ Cover letter and form answers per job | ✅ | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ |
| 📄 Tailored CV per job | ❌ | ✅ | ✅ | ➖ | ✅ | ➖ | ✅ |
| 💾 Saved answer vault, reused on every form | ✅ | ➖ | ➖ | ➖ | ➖ | ✅ | ➖ |
| 🤖 Fills real application forms | ✅ | ✅ | ❌ | ✅ | ⚠️ | ✅ | ⚠️ |
| 🧰 Choice of agent (ChatGPT, Codex, Claude) | ✅ | ❌ | ❌ | ⚠️ | ❌ | ❌ | ❌ |
| 🛡️ You always click Submit (enforced) | ✅ | ⚠️ | ➖ | ❌ | ➖ | ❌ | ➖ |
| 🔍 Post-fill field audit | ⚠️ | ➖ | ➖ | ➖ | ✅ | ✅ | ➖ |
| 📱 Mobile triage (Telegram buttons) | ✅ | ➖ | ⚠️ | ➖ | ➖ | ➖ | ➖ |
| 📋 Application tracking | ✅ | ➖ | ✅ | ✅ | ➖ | ➖ | ➖ |
| ✅ Marked applied automatically on submit | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 🔔 Desktop notifications (started, ready, submitted) | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 🚀 High-volume unattended applying | ❌ | ✅ | ❌ | ✅ | ⚠️ | ✅ | ⚠️ |
| 📈 Published cross-ATS fill-accuracy numbers | ❌ | ➖ | ➖ | ➖ | ⚠️ | ➖ | ➖ |

Notes on the rows: Job-CoPilot.ai sends alerts rather than triage buttons; suxrobGM/jobpilot runs
Claude or Codex; jsmastery-pro's [form-filling report](https://github.com/jsmastery-pro/JobPilot/blob/main/BROWSERBASE_REPORT.md)
documents wrong-field fills on external ATS forms; BhairavJShah's
[autofiller](https://github.com/BhairavJShah/JobPilot-AI/blob/main/automation/form_autofiller.py)
submits when no doubts remain; arthurpanhku's
[Indeed automation](https://github.com/arthurpanhku/job-pilot/blob/main/backend/app/automation/indeed.py)
still has form-fill and submit placeholders. Job Pilotto's audit is ⚠️: every Codex and Claude run is
recorded with a page-derived verdict (guard on, required fields filled, no legal box ticked,
résumé attached; `python3 -m src.ai.apply_run --status` / `--report <URL>`), but field *values*
aren't yet compared to their sources.

**In short:** 🏆 Job Pilotto covers the most of the pipeline — discovery → scoring → kits → filling
→ tracking — with you in control of every submission. 🥈 Hosted tools like JobCopilot.com win on
volume and unattended applying; they don't let you own the sources, scoring or final click.
🧪 Other open-source projects worth borrowing from: [jlifeng/JobPilot](https://github.com/jlifeng/JobPilot)
(editable CV variants), [adrianhajdin/job_pilot](https://github.com/adrianhajdin/job_pilot)
(reference stack), [AgentSpan](https://github.com/agentspan-ai/agentspan) (durable agent runs,
now [part of Orkes Conductor](https://orkes.io/blog/open-sourcing-agentspan-durable-ai-agents/)).

**⚠️ Current gap:** form filling is driven by browser agents and the kit, not a verified form engine.
It has filled forms for real, submitted applications (all on Greenhouse so far), typically in
2–6 minutes, with an accidental-Submit/consent guard and deterministic helpers for ordinary fields. The
guard is not a security boundary, each run's audit checks that fields are filled (not that values
are right), and cross-ATS accuracy hasn't been measured. Always inspect the filled form before submitting.

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
tools/apply-batch-chatgpt.sh --max 5
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
laptop, run `apply-batch-chatgpt.sh` or `apply-batch-claude.sh`, review 3-5 filled forms over
coffee, submit the good ones, and mark them applied. The system never applies on its own initiative — it just makes sure that by the time
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

7. A **Mac**, since `tools/send-to-chatgpt.sh` and `tools/apply-batch-chatgpt.sh` use `osascript`/System
   Events.
8. The **ChatGPT/Codex desktop app**, signed in, with your terminal app granted **Accessibility**
   permission (System Settings → Privacy & Security → Accessibility).
9. **[Claude in Chrome](https://claude.ai/chrome)**, if you'd rather fill forms live with Claude
   instead of (or alongside) Codex — see `.claude/skills/apply-to-job/SKILL.md`.

None of group two is required for the core pipeline; it only matters if you want the same
"queue kits into an AI browser agent" workflow described above.

## Configuration

**Running locally**: on macOS, the maintainer's own scripts (`tools/apply-batch-*.sh`) read
`NOTION_TOKEN` from the Keychain entry `job-pilotto.notion.token` if it's not already exported.
Everywhere else — another OS, CI, or if you'd rather not use Keychain at all — copy
`.env.example` to `.env` and fill in real values; `src/paths.py` loads it automatically (no
library, no manual `source` step) the first time any part of this project runs, without
overriding a variable your shell already has set. `.env` is git-ignored, never committed.

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
| `JOB_PILOTTO_ENRICH_MODEL` | e.g. `claude-haiku-4-5` — turns on AI stage 1 |
| `JOB_PILOTTO_SCORE_MODEL` | e.g. `claude-sonnet-5` — turns on AI stage 2 |
| `JOB_PILOTTO_KIT_MODEL` | model for 📝 Prepare (defaults to `claude-sonnet-5` if unset) |
| `JOB_PILOTTO_AUTO_KIT_MAX` | auto-draft kits for up to N best new matches per crawl (0/unset = off) |
| `JOB_PILOTTO_AUTO_KIT_MIN_SCORE` | minimum fit score to qualify (default 50) |
| `DIGEST_BRAND_NAME` | your digest's display name (default `Job Pilotto`) — the tool's own name stays generic; this is what your Telegram messages say, e.g. `"SRE Job Pilotto"` if you want to keep your own role in the name |

Delete `JOB_PILOTTO_ENRICH_MODEL`/`JOB_PILOTTO_SCORE_MODEL` at any time to stop all AI spending.

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

For the optional local tooling: `JOB_PILOTTO_CV_PATH` points `tools/apply-batch-chatgpt.sh` at your CV
(defaults to `~/Documents/CV.pdf` — the maintainer's own file; set this
to yours).

## How the application automation works

Drafting and filling can be automated end to end; **submitting never is.** The full pipeline, in
order:

1. **A kit gets drafted.** For your best-scored new matches (score ≥ `JOB_PILOTTO_AUTO_KIT_MIN_SCORE`,
   up to `JOB_PILOTTO_AUTO_KIT_MAX` per crawl) this happens automatically after AI stage 2, with no
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
2. **The kit gets filled into a real form.** Four ways to trigger this, freely interchangeable —
   pick whichever's open, or run several at once for different jobs — all of them stop before
   Submit:
   - **Ask an AI coding assistant directly, in whatever session you already have open** — ask
     Claude (with [Claude in Chrome](https://claude.ai/chrome)) or another browser-capable assistant
     to fill the job from its kit; see `.claude/skills/apply-to-job/SKILL.md` for the exact steps
     and per-platform notes (it's written to be readable by any agent, not just Claude).
   - **Queue one or more Claude Code sessions** (macOS only) — `tools/apply-batch-claude.sh`
     opens one new Terminal window per job, each running its own `claude` process pre-seeded with
     the apply-to-job prompt, so several applications run in parallel unattended until each needs
     your review. Pass job URLs directly, `-f jobs.txt`, or `--max N` / `-n N` to auto-pick the N
     highest-scored Saved+kitted jobs via `python -m src.ai.apply_batch --next N` (score comes from
     the Job Matches — AI Scored Notion database). The `jobpilot` shell alias (`cd ~/sre-watch &&
     claude`) is worth setting up alongside this so a plain `claude` session also always starts in
     the right directory.
   - **Queue the ChatGPT/Codex desktop app instead** (macOS only) — `tools/apply-batch-chatgpt.sh` reads
     every Saved job with a kit, builds a plain-text prompt from it, and pastes-and-sends it into a
     new Codex chat per job via `tools/send-to-chatgpt.sh`. Codex fills the form in its own
     embedded browser and stops on its own approval gate.
   - **Queue observable Terminal Codex runs** (macOS only) — `tools/apply-batch-codex-terminal.sh`
     starts one `codex exec` process per job through the Playwright Chrome extension. Its runner
     saves a private trace and structured field/attachment review report outside the repo, checks
     the report for missing evidence, and updates the Notion row's **Next step**. If review-ready,
     it also records active **Form fill time (min)** immediately. Use
     `python3 -m src.ai.apply_run --status` to see ready, needs_user, failed, or stale runs, and
     `python3 -m src.ai.apply_run --report <job URL>` for its field and attachment checklist; rerun a
     failed or stale URL after inspecting the browser tab. Before starting Codex, the runner checks
     the kit for flagged eligibility, work authorization, visa, sponsorship, relocation, and required
     language questions. Those jobs stop as `needs_user` and update Notion **Next step** without a
     model call. An agent that discovers a missing personal answer also reports `needs_user`; resolve
     the answer before retrying. This path has not yet been benchmarked
     across ATS forms, and its report is based on the agent's observations. An injected browser
     script blocks ordinary Submit and legal-consent actions until you explicitly unlock the page;
     it can be bypassed by arbitrary browser code or unusual site behavior, so it is an accident
     guard, not a guarantee. A second script fills known plain fields and audits visible fields
     without another model call. See [the benchmark procedure](docs/application-benchmark.md).
   The **queueing** scripts each flip the job's Stage
   to **Applying** right after queueing, so a second run never queues the same job twice. Asking an
   assistant directly in a session you already have open doesn't touch Stage on its own — you're
   driving that session, so there's nothing to dedupe against.
3. **You review and click Submit yourself**, in every case, in every tool. The agents are instructed
   to stop before Submit; the Terminal Codex path also has an accident guard. Review their work and
   unlock the page only when you are ready to make the final legal choices and submit.
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
  store.py           SQLite store (jobs, companies, AI results, shown history) —
                     `data/jobs.sqlite`, created automatically on first run, nothing to set up;
                     it's a disposable crawl/scoring cache, not a durable record — applications,
                     kits and scores that matter are mirrored into Notion (see below)
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
    apply_batch.py   queues ready kits into the ChatGPT/Codex desktop app; also `--next N`
                     (highest-scored Saved+kitted URLs) and `--mark-applying URL`, both used
                     by tools/apply-batch-claude.sh
  notion/
    client.py        Notion API: Applications, Profile, Job Matches, Application Answers
    matches.py       mirror of scored jobs into Notion Job Matches
config/
  search.json        role/location/tech-stack keywords — what "relevant" means, edit this first
  preferences.json   hard filters (disqualifying languages, excluded companies)
  sources.json       employer feeds always crawled
  scout_seeds.json   candidate employers for the scout (Tier 1, regions)
worker/              Cloudflare Worker for the Telegram bot (commands, buttons)
tools/
  send-to-chatgpt.sh       pastes (and optionally sends) a prompt into the ChatGPT/Codex desktop app
  apply-batch-chatgpt.sh   queues every ready application kit into a new Codex chat, one per job
  apply-batch-claude.sh    opens one Terminal window per job, each its own `claude` session
                           pre-seeded with the apply-to-job prompt; `--max N` auto-picks by score
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
tools/apply-batch-chatgpt.sh --dry-run        # preview what would be queued into Codex
tools/apply-batch-claude.sh --max 3            # auto-pick top-3 by score, one Claude session each
tools/apply-batch-claude.sh <job_url> [more...] # or queue specific jobs by URL
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
Clone https://github.com/GarryOne/job-pilotto (or my fork of it) into this directory. Read README.md,
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
5. Ask me for my CV, and these questions (skip any I've already answered): target job titles;
   seniority; locations, ranked in priority order, and whether I'll do remote/relocate; languages I
   speak and their level; work authorisation for each place I'm targeting; salary target; notice
   period; a few technologies or practices that signal a good employer for my kind of role; any
   companies to exclude (e.g. my current employer); LinkedIn/GitHub/portfolio links.
   From my answers and CV: draft the Profile and Application Answers Notion pages in the structure
   docs/notion-schema.md describes; edit config/preferences.json (disqualifying languages) and
   config/scout_seeds.json (target employers/regions) to match. For config/search.json specifically
   — its values are regex fragments, not plain words — translate my answers into that shape yourself
   rather than asking me to write regex: e.g. "Frontend Developer, mid-level, open to Berlin and
   remote-EU" becomes `role_keywords: ["frontend", "front.?end", "react", "\\bui\\b"]` and
   `locations.top_tier: ["berlin"]`. Show me the generated JSON before writing it, and verify it
   parses and at least one of my own target job titles matches its `role_keywords` regex (e.g.
   `python3 -c "import re,json; c=json.load(open('config/search.json')); print(bool(re.search('|'.join(c['role_keywords']), 'my target title', re.I)))"`
   should print `True`) before moving on. Mark anything I haven't given a clear answer for with ❓ in
   Notion, never invent one.
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
