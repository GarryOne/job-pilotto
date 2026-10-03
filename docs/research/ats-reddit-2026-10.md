# How recruiters really use an ATS (Reddit, Oct 2025 – Oct 2026)

**Verdict:** the evidence supports **knockout questions**, **searchable applicant databases** and **uneven AI**. It does not support
a universal "ATS score" that rejects badly optimised CVs. Source: a ChatGPT research pass over r/recruiting (most of it),
r/ExperiencedDevs and r/resumes, exported 3 Oct 2026. Counts are threads, not recruiters, and say nothing about market share.

| Question | What the threads support | Threads |
|---|---|---|
| Does an ATS auto-reject? | Yes, on configured questions: work authorisation or sponsorship, location or office attendance, a required licence or language | 1–2 each |
| Years-of-experience rule | Screening is reported; **no** inspectable automatic threshold | 0 |
| What recruiters see | Boolean search over the pool (5k → 40), AI grades or summaries, overridden by hand ("I've hired people AI called a D") | 1–2 |
| AI in use | Screening help 4, interview notes 2, sourcing 2, scheduling 1; **no** fully autonomous hiring | 4 |
| First look | About 10–20 s per CV: location, minimum experience, skills; some start at the answers to the application questions | 1 |
| Formatting failures | **No** firsthand recruiter evidence. One scanner developer (not a recruiter) reports columns, tables, headers | 0 firsthand |
| AI-written CVs | The worry is credibility at interview, not detection | 2 |

**Disagreements:** AI auto-rejection is "common" vs "does not reject CVs" (the second is better evidenced); review everyone vs search a
subset; AI sourcing helps vs "all garbage, false positives". **Marketing to discount:** a resume-scanner developer, a resume-service founder,
a CV-scoring tool promoter, recruiting-software vendors in the AI-workflow thread.

## What Job Pilotto does with it
- **Knockout questions come first.** The form panel marks them ⛔ in "Left for you" and says why (`extension/review.js`, `KNOCKOUT`).
- **The CV check is a readiness check, not an ATS score** (`desktop/lib/cv-check.js`). Parser penalties for photos, banners and columns are small
  and worded as unconfirmed; the weight is on text that exists, contact details as text, standard headings, dates, length.
- **A clear top of page 1** matters: recruiters search, then spend seconds on the matches. The content review looks at keywords for the target roles.
- **Next:** a job-level match check (this posting vs the attached CV) on Application sessions.
