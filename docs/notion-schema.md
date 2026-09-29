# Notion schema reference

Exact property names and types this project reads and writes, so you can create your own copies
from scratch rather than guessing from the source code. Create each as a **database** (unless
marked "page"), share it with your Notion integration, and set its ID via the matching environment
variable (see the main README's Configuration section) — property names must match exactly.

## Applications — Job Tracker (database)

Env var: `NOTION_APPLICATIONS_DB`. One row per job you've saved, applied to, or dismissed.

| Property | Type | Notes |
|---|---|---|
| Job | Title | |
| Company | Text | |
| Location | Text | |
| Job URL | URL | Canonical posting URL — the match key everything uses |
| Stage | Select | Options: `Kit ready` (a kit was drafted automatically), `Saved` (you tapped ⭐), `Applying`, `Applied`, `Confirmation received`, `Screening`, `Interview scheduled`, `Interviewing`, `Offer`, `Rejected`, `Withdrawn`, `No response`, `Dismissed`, `Closed` (posting gone) |
| Source | Select | Options: `Telegram`, `Manual` |
| Applied on | Date | Set when Stage becomes Applied |
| Posted | Date | Posting date from the source, or first-seen date if unknown |
| Next interview | Date | You fill this in manually |
| Next step | Text | You fill this in manually |
| Form fill time (min) | Number | Active AI form-filling minutes, written at the ready-for-review handoff |
| Kit cost (USD) | Number (dollar) | Anthropic API cost of drafting this job's kit, written when it's drafted |
| Notes | Text | You fill this in manually |
| Salary | Text | You fill this in manually |
| Contact | Text | You fill this in manually |
| Confirmation email | Checkbox | You fill this in manually |

Frozen when the job is marked Applied (`src/notion/ledger.py`), for learning which applications get
replies:

| Property | Type | Notes |
|---|---|---|
| Recorded | Date | When the application record was frozen |
| Fit score | Number | AI stage 2 score at the time |
| Tier | Select | `A`, `B`, `C` |
| Seniority | Select | Same options as Job Matches |
| Work mode | Select | `On-site`, `Hybrid`, `Remote` |
| Recruiter | Checkbox | |
| ATS | Select | `Greenhouse`, `Ashby`, `Lever`, `Workable`, `Other` |
| Agent | Select | `Claude`, `Codex`, `ChatGPT`, `Manual` (from the local form-filling run record) |
| Days to apply | Number | Days from Posted to Applied on |
| Cover letter | Checkbox | |
| Questions | Number | Questions answered |
| Answers captured | Select | `Form` (read from the page just before Submit), `Kit draft`, `None` |
| CV version | Text | File name and a short content hash |
| Kit variant | Text | Kit prompt variant, for experiments |
| Channel | Select | `Direct`, `Recruiter platform`, `Agency`, `Referral` — how you applied; set from the URL when empty |
| Via | Text | Recruiter platform or agency, e.g. TechTree; Company holds the real employer |
| Date approximate | Checkbox | Applied on is an upper bound ("on or before") |
| Events | Relation | Two-way with 📈 Application Events |
| Agent runs | Relation | To NOTION_AGENT_RUNS_DB |
| Days since applied | Formula |  |
| Fill time | Formula |  |
| Fresh | Formula |  |
| Interviews | Relation | To NOTION_INTERVIEWS_DB |
| Last update | Last edited time |  |
| Tailored CV | Files |  |
| Rejection reason | Select | Options: `Presentation`, `Hard skills`, `Soft skills`, `Not a fit (not on you)`, `Unclear` |
| Rejection lesson | Text |  |
| Reached via | Select | Options: `Email`, `LinkedIn`, `Phone`, `Other` |
| Kit inputs | Text |  |
| Feedback status | Select | Options: `Not asked`, `Asked for feedback`, `Received feedback`, `Skipped` |
| Employer feedback | Text |  |
| Interview prep | Date | When the interview prep kit was built (🎤 Interview prep on the page; Focus → Prepare) |

The page body gets a "🗂 Application record" toggle section: every question with the answer sent
(and the kit's draft, marked ✏️ when edited), the cover letter, and a JSON block with the job
description, AI facts and scores.

The application kit (📝 Prepare, or auto-drafted) is written as a toggle heading block named
"📝 Application kit" inside each row's page content — that's page content, not a database property,
so it doesn't need a schema entry.

## Job Matches — AI Scored (database)

Env var: `NOTION_MATCHES_DB`. One row per job AI stage 2 has scored; rebuilt from SQLite, safe to
delete and let it repopulate.

| Property | Type | Notes |
|---|---|---|
| Job | Title | |
| Score | Number | 0-100 |
| Tier | Select | Options: `A`, `B`, `C` |
| Company | Text | |
| Location | Text | |
| Reason | Text | One line |
| Strengths | Text | Semicolon-separated |
| Gaps | Text | Semicolon-separated |
| Role fit | Number | 0-100 |
| Location fit | Number | 0-100 |
| Compensation fit | Number | 0-100 |
| Growth | Number | 0-100 |
| Risk | Number | 0-100, higher = more risk/uncertainty |
| Confidence | Select | Options: `high`, `medium`, `low` |
| Job URL | URL | |
| Code | Text | 8-hex job code, e.g. for `/apply_<code>` |
| Status | Select | Options: `Open`, `Applied`, `Dismissed`, `Not seen` (the crawl no longer lists it; not proof it closed) |
| Scored | Date | |
| Seniority | Select | Options: `Junior`, `Mid`, `Senior`, `Staff/Principal`, `Lead/Manager` |
| Work mode | Select | Options: `On-site`, `Hybrid`, `Remote` |
| Languages | Multi-select | e.g. `English`, `German +` (a "+" suffix means "a plus", not required) |
| Salary | Text | |
| Recruiter | Checkbox | |
| Technologies | Text | Key technologies from the posting (stage 1), semicolon-separated |
| Role family | Select | `sre`, `platform`, `devops`, `cloud_infrastructure`, `software`, `data`, `security`, `support_it`, `other` |
| Last update | Last edited time |  |
| First seen | Date |  |
| Scoring method | Select | Options: `Current`, `Previous` |

## Employers & Sources (database)

Env var: `NOTION_EMPLOYERS_DB`. One row per employer or job board the crawler knows about; the
scout creates and updates these (optional since the central employer index: the crawler downloads that and merges it with
`config/sources.json`, so this database is only your own list). Optional for a first run — the crawler falls back to
the downloaded index, `config/sources.json` and its own local feed table if this database is empty or unset.

| Property | Type | Notes |
|---|---|---|
| Company | Title | |
| Kind | Select | Option used by code: `Employer` |
| Tier | Select | Free text from `config/scout_seeds.json`, e.g. `Tier 1` |
| Feed status | Select | Options: `Feed found`, `Low relevance`, `Manual watch`, `No public feed` |
| Active | Checkbox | Whether the crawler includes this feed |
| Origin | Text | Where the candidate came from (seed list, Hacker News, ...) |
| Glassdoor | URL | Auto-filled search link |
| levels.fyi | URL | Auto-filled search link |
| Checked | Date | |
| Quality | Number | 0-100 |
| ATS | Select | Options: the systems in `src/sources/ats.py` (Greenhouse, Lever, Ashby, Workable, Recruitee, Personio, SmartRecruiters) |
| Slug | Text | |
| Feed | URL | |
| Careers | URL | |
| Cities | Text | |
| Relevant roles | Number | |
| In preferred places | Number | |
| Notes | Text | |
| Integration | Select | Option used by code: `Working` |
| Added | Date | |
| Size | Text |  |
| Verification | Select | Options: `Career link found`, `Needs research`, `Location conflict` |
| Website | URL |  |

## 📈 Application Events (database)

Env var: `NOTION_EVENTS_DB`. One row per outcome change of an application; the Applications Stage
holds only the latest. Written by `ledger.mark_applied` (watcher / `--mark-applied`), the Telegram
✅ Applied button, the `/applied` outcome buttons (Worker), and `ledger.sync` on scheduled runs (a
Stage edited by hand in Notion, and the 30-day no-response rule).

| Property | Type | Notes |
|---|---|---|
| Event | Title | "Kind · Company" |
| Application | Relation | To Applications — Job Tracker (two-way, shows there as "Events") |
| Kind | Select | `Applied`, `Reply received` (a human answered; no Stage change), `Confirmation received`, `Screening`, `Interview scheduled`, `Interviewing`, `Offer`, `Rejected`, `Withdrawn`, `No response` |
| At | Date | With time |
| Source | Select | `Telegram`, `Notion edit`, `Watcher`, `Auto rule`, `CLI`, `Backfill`, `Gmail`, `Calendar` |
| Source ID | Text | Gmail message id, or `cal:<event id>`; an email or calendar event is never logged twice |
| Note | Text | |
| Job URL | URL | |
| Changes | Text | JSON: what the email changed (before/after per field), its interview time and sender; "Undo an email update" puts it back |
| Needs you | Checkbox | The Gmail check wasn't sure which job: Focus asks "Is this about …?" |
| Suggested job | URL | The likeliest job for a Needs-you email (its Job URL) |

## 🎤 Interviews (database)

Env var: `NOTION_INTERVIEWS_DB`. One row per interview (`src/ai/interviews.py`): sent to the bot, or
saved from the app's Interviews page. The page body holds the analysis (strengths, weak spots, signals,
practice, every question with ✅/➖/⚠️/❌) and the full transcript in a toggle. A transcript saved from
the app without a review has only the transcript (and a "Not reviewed yet" line where the review goes);
its Overall is empty until it's reviewed.

| Property | Type | Notes |
|---|---|---|
| Interview | Title | "Company · Round" |
| Application | Relation | To Applications — Job Tracker (two-way, shows there as "Interviews"); empty when unclear |
| Date | Date | |
| Round | Text | e.g. Recruiter screen, Technical 1 |
| Overall | Select | `positive`, `neutral`, `negative` |
| Questions / Weak answers | Number | |
| Topics / Weak topics | Text | Semicolon-separated; the insights count these across interviews |
| Next step | Text | |
| Input | Select | `Recording` (transcribed with speakers by `src/ai/transcribe.py`), `Transcript`, `Notes` |
| Cost (USD) | Number (dollar) | |
| Model | Text | |
| Questions | Number |  |
| Topics | Text |  |
| Weak answers | Number |  |
| Weak topics | Text |  |

## 💡 Insights (database)

Env var: `NOTION_INSIGHTS_DB`. One row per daily insight (`src/ai/insights.py`), created before the
Telegram message so its buttons can point at the row.

| Property | Type | Notes |
|---|---|---|
| Insight | Title | The headline |
| Date | Date | One insight per day; the scheduled run checks this before making another |
| Category | Select | `Skills`, `CV`, `Location`, `Salary`, `Seniority`, `Role focus`, `Timing`, `Activity`, `Process` |
| Basis | Select | `Market`, `Applications`, `Both` |
| Confidence | Select | `high`, `medium`, `low` |
| Sample size | Number | Jobs or applications behind the finding |
| Evidence | Text | One line per figure |
| Action | Text | |
| Feedback | Select | `Useful`, `Not useful`, `Acting on it` — set by the Telegram buttons; the next insights read it |
| Cost (USD) | Number (dollar) | |
| Model | Text | |
| Issue detected | Checkbox |  |

## ⏰ Cronjob Runs (database)

Env var: `NOTION_CRON_RUNS_DB`. One row per scheduled pipeline run (`daily.yml`, modes `scheduled`,
`run`, `today`, only when sending), written by `src/notion/cron_runs.py` at the end of
`daily.main()`. The page body holds the mini-report and per-stage token/cost lines. Costs come from
`src/ai/cost.py` (Haiku 4.5 $1/$5, Sonnet 5 $2/$10 per million tokens; cache read 0.1x, write 1.25x).

| Property | Type | Notes |
|---|---|---|
| Run | Title | "YYYY-MM-DD HH:MM · mode" (UTC) |
| Started | Date | With time |
| Duration (s) | Number | |
| Mode | Select | `scheduled`, `run`, `today`, `prepare`, `insight`, `weekly`, `interview`, `mail` — every AI job logs a row, so they add up to the month's AI spend (the budget guard sums them) |
| Trigger | Select | `Schedule`, `Manual` (workflow_dispatch / Telegram), `Local` |
| Status | Select | `OK`, `Warnings` (a stage skipped or a feed failed), `Quiet` (nothing new) |
| Feeds / Feed errors | Number | Employer feeds scanned / failed |
| New jobs / Changed jobs | Number | From this crawl |
| Closed stale | Number | Jobs not seen for 7 days |
| Enriched / Scored / Kits / Insights / Interviews / Emails | Number | Done this run per AI stage |
| Top new score | Number | Best fit score among jobs first seen this run |
| Cost enrich / score / kits / insight / interview / mail (USD) | Number | Per stage |
| AI cost (USD) | Number | Total |
| Tokens (total) | Number | In + out + cached, all stages |
| Telegram | Text | Sent / not sent |
| Summary | Text | Report headline |
| Run URL | URL | GitHub Actions run |
| Changed jobs | Number |  |
| Cost enrich (USD) | Number |  |
| Cost insight (USD) | Number |  |
| Cost interview (USD) | Number |  |
| Cost kits (USD) | Number |  |
| Cost mail (USD) | Number |  |
| Cost score (USD) | Number |  |
| Emails | Number |  |
| Enriched | Number |  |
| Feed errors | Number |  |
| Feeds | Number |  |
| Insights | Number |  |
| Interviews | Number |  |
| Kits | Number |  |
| New jobs | Number |  |
| Scored | Number |  |
| Application | Relation | To NOTION_APPLICATIONS_DB |
| Updates | Number |  |

Views: **Latest runs** (newest first), **AI cost per day** (column chart).

## 🤖 Job Apply — Agent Runs (database)

Env var: `NOTION_AGENT_RUNS_DB`. One row per form-filling session, written by
`python3 -m src.ai.apply_run` (Codex runs and `--record` for Claude runs). Optional: runs are still
recorded locally without it. Rows never contain applicant values, only field labels and ✓/CHECK.

| Property | Type | Notes |
|---|---|---|
| Run | Title | "Company · Job · Agent" |
| Job | Relation | To Applications — Job Tracker (two-way, shows there as "Agent runs") |
| Job URL | URL | |
| Company | Text | |
| Agent | Select | Options: `Claude`, `Codex`, `ChatGPT`, `Manual` |
| ATS | Select | Options: `Greenhouse`, `Ashby`, `Lever`, `Workable`, `Other` |
| Status | Select | Options: `Ready`, `Needs input`, `Failed` |
| Started | Date | With time |
| Ended | Date | With time |
| Minutes | Number | Active fill time |
| Fields | Number | Visible non-legal fields audited |
| Unfilled required | Number | |
| Reason | Text | Why it isn't Ready |
| Learnings | Text | One-line finding; agents read these before filling (`--learnings`) |
| Billed to | Select | Options: `Claude subscription`, `ChatGPT plan`, `Anthropic API credits`, `Unknown` — form filling doesn't use API credits |
| Tokens (total) | Number | All tokens the session used from start to hand-over (incl. cached context), from its transcript/trace |
| Output tokens | Number | |
| Run ID | ID | Prefix `RUN` |
| Age (days) | Formula |  |
| Fill time | Formula |  |
| Fresh | Formula |  |
| Job stage | Rollup |  |
| Waiting for you | Formula |  |
| Claude working (min) | Number |  |
| Waiting for you (min) | Number |  |
| Times asked | Number |  |
| Your reply (median s) | Number |  |
| Ready → decided (min) | Number |  |
| Outcome | Select | Options: `Submitted`, `Not submitted`, `Open`, `Restarted`, `Cancelled` |
| Turns | Number |  |
| Tool calls | Number |  |
| Tools used | Text |  |
| Tokens in | Number |  |
| Tokens out | Number |  |
| Cache read | Number |  |
| Model | Text |  |
| Session timeline | Text |  |

The page body lists per-step timings, each field ✓/CHECK, attachments and the learning.

## Profile — CV and Preferences (page, not a database)

Env var: `NOTION_PROFILE_PAGE_ID`. A single Notion page, read as plain text every scoring run — no
fixed property schema, just headings and content. Recommended sections (see the maintainer's own
page for a worked example, or write your own in whatever structure suits you — the scorer just
reads all the text):

- **Hard constraints** — countries/cities you'll work in, work permit and languages, minimum
  seniority, workload, employment type, recruiter tolerance
- **Compensation** — your target, as a range or a single figure
- **Preferences** — role types, company size, industries, on-call tolerance, leadership scope
- **Summary** — a few sentences from your CV
- **Core skills** — grouped by area
- **Experience** — a table of role, company, dates, highlights

## Application Answers — Standard Form Fields (page, not a database)

Env var: `NOTION_ANSWERS_PAGE_ID`. A single page, kept separate from Profile so editing it doesn't
re-trigger scoring. Read by the kit drafter. Recommended sections:

- **Eligibility** — work authorisation per country/region you apply to, remote-work eligibility
- **Availability and pay** — notice period, salary expectations per currency/region, relocation
- **Links** — LinkedIn, GitHub, website, CV filename
- **Common questions** — "how did you hear about us", demographic-question defaults (e.g. "decline
  to self-identify"), consent-to-keep-data default
- **Cover letter style** — length, tone, what to always/never mention

Mark anything you haven't decided yet with ❓ — the kit drafter treats that as "draft your best
guess and flag it for review," never as a fact to state confidently.
