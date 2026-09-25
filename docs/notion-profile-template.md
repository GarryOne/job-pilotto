# Notion page templates

Paste each section below directly into a new Notion page (Notion converts pasted Markdown tables
and headings automatically). Create the two pages named in `docs/notion-schema.md`, set
`NOTION_PROFILE_PAGE_ID` / `NOTION_ANSWERS_PAGE_ID` in `.env` to their IDs, and replace every ❓
with your own answer — the AI stage 2 scorer and the kit drafter both treat ❓ as "guess and flag
for review," never as a fact.

## 👤 Profile — CV and Preferences

The AI scorer (stage 2) reads this page at every run to judge how well each job fits. Edit freely;
changing it re-scores all open jobs on the next run.

# Hard constraints

Jobs that break these are filtered out before any AI scoring.

| Constraint | Value |
|---|---|
| Countries | ❓ e.g. "Switzerland (anywhere), plus Berlin, London, or remote roles" |
| Home base | ❓ your current city; open to relocating? |
| Acceptable cities / commute | ❓ |
| Work mode | ❓ on-site / hybrid / remote acceptable? |
| Work permit / visa | ❓ your status, and whether you need sponsorship anywhere you're applying |
| Languages I can work in | ❓ |
| Languages that disqualify a job if required | ❓ |
| Minimum seniority | ❓ e.g. "Senior or higher" |
| Workload | ❓ 100% only, or a range |
| Employment type | ❓ permanent only, or contract too |
| Recruiter listings | ❓ allow / down-rank / exclude |

# Compensation

- Target: ❓ a figure or range, and whether it's net or gross
- Minimum acceptable: ❓ per country/currency you apply in, if it varies

# Preferences (soft, used for ranking)

| Preference | Value |
|---|---|
| Role types, most wanted first | ❓ |
| On-call | ❓ acceptable rotation? |
| Company size | ❓ |
| Industries to prefer / avoid | ❓ |
| Leadership | ❓ IC only, or tech lead / manager roles too? |
| Start date / notice period | ❓ |

# Application form answers — voluntary demographic surveys

Optional. Only fill this in if you want a standing answer for equal-opportunity survey questions
(age bracket, gender, disability, ethnicity, etc.) so the kit drafter doesn't ask each time.

# Education

| School | Degree | Discipline |
|---|---|---|
| ❓ | ❓ | ❓ |

# Summary (from CV)

❓ A few sentences describing your experience and focus, from your CV.

# Core skills

❓ Grouped by area (e.g. Cloud, Containers, IaC, Observability, Languages).

# Experience

❓ One entry per role: title, company, dates, 2-4 bullet highlights with real numbers where you
have them. Verbatim from your CV is fine — the kit drafter only uses facts stated here, never
invents experience.

# Links

- LinkedIn: ❓
- GitHub: ❓
- Website / portfolio: ❓

---

## 📝 Application Answers — Standard Form Fields

Standard answers for job application forms. Kept separate from Profile on purpose: editing this
page does not re-trigger AI scoring. Contact details (email, phone, address) should **not** go on
this page — see "Where the CV file and contact details live" below.

# Eligibility

| Question | Answer |
|---|---|
| Authorised to work in [your home country/region]? | ❓ |
| Authorised to work in [each other region/country you apply to]? | ❓ Add one row per country you're likely to apply in |
| Remote from your base for a foreign employer? | ❓ |

# Availability and pay

| Question | Answer |
|---|---|
| Notice period / earliest start | ❓ |
| Salary expectation — [country 1] | ❓ |
| Salary expectation — [country 2] | ❓ Add one row per currency/region you apply in |
| If a salary field is optional | ❓ leave blank, or always fill |
| Willing to relocate | ❓ |
| Current location | ❓ |

# Links

| Field | Value |
|---|---|
| LinkedIn | ❓ |
| GitHub | ❓ |
| Website / portfolio | ❓ |
| CV file | ❓ filename only — the actual path is set via `JOB_PILOTTO_CV_PATH` in `.env`, never written here |

# Common questions

| Question | Answer |
|---|---|
| How did you hear about us? | ❓ default, e.g. "company careers page / the job board where it was found" |
| Previously worked for / applied to this company? | Answered per job |
| Demographic / EEO questions | ❓ default, e.g. "Decline to self-identify," or point at the Profile page's demographic section |
| Pronouns | ❓ or leave blank |
| Consent to keep data for future roles | ❓ yes / no |

# Cover letter style

- Length: ❓ e.g. "~200-250 words, 3 short paragraphs"
- Tone: ❓ e.g. "direct and factual, no clichés"
- Always mention: ❓
- Never mention: ❓

## Where the CV file and contact details live

Neither belongs in Notion:

- **CV file path**: set `JOB_PILOTTO_CV_PATH` in your local `.env` (see `.env.example`). Never
  commit the PDF itself — `.gitignore` already excludes `*.pdf`.
- **Contact details** (email, phone, address): keep these wherever your form-filling tool reads
  them from locally (e.g. the macOS Keychain, or a local-only file outside the repo). Job Pilotto
  never sends these to Notion.
