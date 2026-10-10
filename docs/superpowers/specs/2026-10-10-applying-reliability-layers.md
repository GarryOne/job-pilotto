# Applying reliability: four layers (10 Oct 2026)

> **Verdict:** every applying fix stays fixed. Four layers, each catching what the others cannot: journey scenarios (logic, every push), recorded
> pages (every site we ever fixed, replayed offline with the real extension), a nightly live smoke (sites that changed), fleet numbers per board
> (sites nobody tested). Owner approved all four on 10 Oct 2026 ("let's implement all 4 layers").

| Layer | What | Runs | Catches | Code |
|---|---|---|---|---|
| 1 | Journey scenarios: the flow as event sequences | every flow-file push, <1 s (journey gate) | a flow broken by a fix | `desktop/test/journeys.test.js` (built, `48b5e89`) |
| 2 | **Recorded pages**: each page of a fixed site (posting, sign-in, sign-up, form) captured once, scrubbed, replayed in headless Chrome with the real extension and recorded AI answers, no network | flow-file pushes (when the set stays < 3 min) and before every release | "we fixed jobs.ch, then broke it again" | `desktop/e2e/recorded/` cases, `desktop/e2e/lib/page-replay.mjs`, `twin:drive capture` |
| 3 | **Live smoke**: a rotating set of 5–10 real postings from the owner's list, up to the filled form, never Submit | nightly on the Mac (the plan, no API key) | a site that changed under us | `desktop/e2e/smoke.mjs`, built on `npm run live` (`e2e/lib/apply-live.mjs`) |
| 4 | **Fleet numbers per board**: the digest's per-board fill rate, recent 3 days vs the 4 before, a drop flagged | continuous; read by the smoke report | real users on sites we never tested | `site/src/digest.js` |

## Layer 2: a recorded case
`desktop/e2e/recorded/<shape>-<n>/case.json` + one `<page>.html` per page:
- `pages`: `[{url, file}]`: served at the real address (`context.route` fulfils it), so the extension sees the real host;
- `ai`: the app's answers for this case, by route (`/extension/page-kind`, `/extension/account-judge`, `/extension/pick-choice`, …), recorded from the twin's
  decisions when captured (the harness's `answer` option; no AI is called in a replay);
- `expect`: what must happen, in fixed words: `{role, applyPressed, accountMove, filled: {min}, left: {max}, tabsOpened: {max}}`.
- Named by **shape** ("email-first sign-up", "CV choice step", "cookie banner with links"), the site is the sample (universal rule).

**Privacy (the repo is public):** capture keeps the page's structure only: every input value, password, textarea text and selected option is
removed; scripts, iframes' content, cookies, tracking and URL query strings are dropped; text equal to any value of the person's profile (name, email,
phone, address) is replaced by the fake applicant's. `desktop/test/replay-privacy.test.js` fails when a case contains any of the profile's values
(read locally from the app's profile when present; CI checks the fixed fake ones) or an email/phone pattern other than the fake applicant's.

**Each fix adds its case** in the same change (the twin loop's rule): capture the page from the twin, write the expectation, see it fail on the old
extension (`REAL_EXTENSION_DIR`), then pass.

## Layer 3: nightly live smoke
- A list `desktop/e2e/smoke-sites.json`: 10 shapes chosen for different flows (10 Oct 2026), each `like` (the owner's own jobs, read-only, rotating by day) or
  `urls` (fixed public postings from public job feeds).
- **A big pool, rotated** (owner, 10 Oct 2026: 50–100 sites, 10 a night): `SMOKE_PER_NIGHT` (10) shapes a night, a window moving each day, so all are run every
  pool/10 nights; each shape is compared with ITS last run, however many nights ago (`--all` runs the whole pool, `--only` some).
- **Distinct flows, not distinct addresses** (owner, 10 Oct 2026): each run records a flow signature (the page kinds in order, the host the journey
  ended on, how far it got). `npm run smoke -- --discover [--limit N]` runs candidates from the loaded profile's jobs (a few per host, more from job
  boards) once each and adds to the Mac's list only those with a signature the pool does not have.
- Each run: the e2e app + a headless Chromium + the real extension (the `npm run live` machinery, its isolation), Apply pressed through the app's API,
  stopped before any account button or Submit (HELD), a report per posting: reached step, filled/left, page kinds, errors.
- The report is compared with the last run: a shape that reached less than before is a regression, listed first; a posting gone (HTTP 404/410) is noted,
  never a regression. Saved to `desktop/e2e/smoke-reports/<day>.json` (git-ignored: it names real postings) with each run's log; exit 1 on a regression.
  The session that reads it files the Bug Tracker row (a script holds no Notion token). `npm run smoke [-- --only <shape words>]` in `desktop/e2e`.
- Scheduling is the owner's choice (a launchd job on the Mac, or by hand); the runner itself never schedules.

## Layer 4: fleet numbers per board
The digest gains, per board, the recent window (3 days) vs the 4 days before, and `dropped: true` when the fill rate fell by more than 10 points
on at least 5 forms. The smoke report lists dropped boards beside its own regressions.

## Data ownership
Recorded cases are test fixtures in the repo (no personal data, enforced by a test). Smoke reports stay on the Mac (`logs/smoke/`), a regression
row goes to the Notion Bug Tracker. The digest stays on the site (D1). Nothing new is stored about the user.

## Landing order
1. Layer 2 harness + the privacy test + the first cases from today (cookie banner with links, email-first sign-up, CV choice step).
2. `twin:drive capture` (scrubbed capture from the twin).
3. Layer 4 per-board drop.
4. Layer 3 runner + report + comparison; then ask the owner about scheduling.
