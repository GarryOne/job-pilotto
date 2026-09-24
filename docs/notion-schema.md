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
| Stage | Select | Options: `Saved`, `Applying`, `Applied`, `Confirmation received`, `Screening`, `Interview scheduled`, `Interviewing`, `Offer`, `Rejected`, `Withdrawn`, `No response`, `Dismissed` |
| Source | Select | Options: `Telegram`, `Manual` |
| Applied on | Date | Set when Stage becomes Applied |
| Posted | Date | Posting date from the source, or first-seen date if unknown |
| Next interview | Date | You fill this in manually |
| Next step | Text | You fill this in manually |
| Notes | Text | You fill this in manually |
| Salary | Text | You fill this in manually |
| Contact | Text | You fill this in manually |
| Confirmation email | Checkbox | You fill this in manually |

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
| Status | Select | Options: `Open`, `Applied`, `Dismissed`, `Closed` |
| Scored | Date | |
| Seniority | Select | Options: `Junior`, `Mid`, `Senior`, `Staff/Principal`, `Lead/Manager` |
| Work mode | Select | Options: `On-site`, `Hybrid`, `Remote` |
| Languages | Multi-select | e.g. `English`, `German +` (a "+" suffix means "a plus", not required) |
| Salary | Text | |
| Recruiter | Checkbox | |

## Employers & Sources (database)

Env var: `NOTION_EMPLOYERS_DB`. One row per employer or job board the crawler knows about; the
daily scout creates and updates these. Optional for a first run — the crawler falls back to
`config/sources.json` and its own local feed table if this database is empty or unset.

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
