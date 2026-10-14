# The apply-flow workflow: record once, work offline

> **Verdict (owner, 14 Oct 2026):** we record each site once and do all testing, fixing and verifying offline ($0).
> Live visits happen only to record. You start step 3; the coordinator (job-pilotto-cc) routes; the rest runs by itself.

| # | Step | Who / what | Live? | Cost |
|---|---|---|---|---|
| 1 | **Record** a new site once, all the way to the form; re-record only on a signal | skill `record-applying-sites` (today `run-applying-smoke-pool`); `record-sites.yml`, whose single job is recording | ✅ the only live step | cents per row |
| 2 | **Detect**: replay every recording on the build | CI: `site-replays-pr.yml` on every PR, `site-replays.yml` nightly → `/admin/applying` | no | $0 |
| 3 | **Fix** the top 🔴 row | skill `/fix-failing-forms` | no | $0 + the fix session |
| 4 | **Verify** the fix | CI after merge: "Confirmed offline" on the Fixed tab (2 agreeing replays) | no | $0 |
| 5 | **Benchmark** (occasional) | bake-off: the extension vs other agents on the same forms (repo job-pilotto-bakeoff) | yes | dollars: owner's OK |

## The signals that start each step
- **Record (1):** a new site on the pool list; installs' outcomes on a job board dropping against its own last 14 days (counts only, k ≥ 3); a person's report;
  a "Blind spot" on the platform scorecard (real fills miss what the pool reaches: record that site).
  Never a schedule. A replay that changed is our build, never a reason to re-record.
- **Fix (3):** a 🔴 row on `/admin/applying` → Fixes → Needs a fix (one status per row: 🟢 works · 🟣 held on purpose · ⚪ site problem · 🔴 needs a fix).
  A "regression" row says whether it is **Our build** or **Site changed** (the same recording replayed on two builds).
- **Verify (4):** a merge. "Needs live" means the fix took a route the recording never had: re-record that row with the full journey (step 1).

## What a step never does
- Never Submit, never a captcha or bot check, never past a login wall, never read a password field; the fake applicant only; the privacy tripwire on.
- At most 3 live visits per host per day (CI's ledger: a by-hand run uses 1 of 2).
- No site names or hosts in code, tests or PR bodies; a fix is universal and lands with a recorded case that fails on the old build.
- No live run to test or to prove a fix; no AI spend without the owner's OK and a measured cost.

## App bugs (not form bugs)
The Desktop App's own screens (session cards, review panel, tabs) are not in the replay. A bug you see yourself → skill `desktop-change`
with a test in `desktop/test/app-scenarios.test.js`. The twin (docs/live-test.md) reproduces it on demand; it is never a loop.

## Skills for this workflow
| Skill | Step | State |
|---|---|---|
| `run-applying-smoke-pool` → `record-applying-sites` | 1 | being renamed and trimmed to recording |
| `improve-filling` | 1 | being folded into `record-applying-sites` as the real-use signal, then retired |
| `fix-failing-forms` | 3-4 | being trimmed to the offline loop |
| `apply-to-job` | not testing: the instructions the app gives Claude when it finishes a page (rung 5), a backup we aim never to need | kept |
| `desktop-change` | app bugs | kept |
| ~~the live twin loop skill~~ | removed 14 Oct 2026 | — |

<details><summary>Gaps being closed (14 Oct 2026) and where</summary>

| Gap | Where |
|---|---|
| "Confirmed offline" and the regression verdict (Our build / Site changed) | job-pilotto-8e PR; bisect to the first bad commit next |
| The pool becomes a recorder; skill rename; re-record signals on the page | job-pilotto-cf, spec `docs/superpowers/specs/2026-10-15-record-once.md` (A) |
| A CI recording never updates the pool table (`applying-report.mjs` refuses CI) and must reach the replay's records | job-pilotto-cf (A), its first PR |
| Rules, skills and page words that still require a live proof | job-pilotto-cf (B), after 8e |
| Recording past where the extension stops (full journey) | job-pilotto-cf (C) |
| `fix-failing-forms` still describes live runs, the heavy lock, `npm run row`, `twin:drive` | job-pilotto-cf (B) |
</details>
