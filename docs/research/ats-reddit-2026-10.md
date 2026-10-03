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


---
## Second pass: ten product decisions (3 Oct 2026)
A follow-up research pass with stricter rules (vendor promotion excluded, vendor documentation kept apart as "capability, not behaviour").

- **Knockout:** Greenhouse (Plus/Pro), Ashby and SmartRecruiters document auto-reject on question answers; Lever and Workday are unverified (do not read that as "only flags").
  Reddit: one thread, a recruiter's account. Wording rule: "can trigger automatic rejection if the employer has configured a knockout rule"; "may be flagged for review" when unknown.
- **Where the answer lives:** screening questions and location come before the CV (1 thread); no evidence for "CV wins" or "answer wins". Show a contradiction between CV and answer for review; keep residence, relocation, onsite, authorisation and sponsorship separate.
- **First screen:** 10–20 s per CV (1 thread); a generic summary is skipped in half a second (1 thread). A readability point, not a reject trigger.
- **Search:** recruiters Boolean-search required terms and title aliases (2 threads); field scope (CV text vs parsed fields) unknown.
- **Parse failures:** 0 qualifying admin or recruiter threads. Penalise observed extraction errors only; layout alone is a prompt to check (copy-and-paste test). Numerical weights remain hypotheses.
- **Tailoring and AI:** truthful AI polish is accepted (1 thread); no evidence of AI detection or a keyword-stuffing threshold. Include skills that have supporting experience.
- **Rejection speed:** timing alone proves nothing (a 3 AM batch email; Ashby and SmartRecruiters delay emails). Never tell a user the CV "failed the ATS" from timing.
- **Referrals:** conflicting hiring outcomes; no ranking bypass shown. Frame as "a relevant person may see it".
- **Switzerland, Germany, UK, EU:** photo is optional in Switzerland (individual preferences); no regional ATS differences established. EU AI Act treats CV-sorting AI as high-risk (employment rules from 2 Dec 2027); FDPIC and ICO guidance apply. Offer a photo choice and a version without.

**Implemented from this pass:** the knockout warning wording; the CV check no longer penalises layout alone; the content review treats a generic summary as readability.
**Next:** contradiction review (CV vs form answers), a job-level match check on Application sessions, a photo-optional CV version.
