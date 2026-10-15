# The apply-flow workflow: record once, work offline

> **Verdict (owner, 14 Oct 2026):** we record each site once and do all testing, fixing and verifying offline ($0).
> Live visits happen only to record. You start step 3; the coordinator (job-pilotto-cc) routes; the rest runs by itself.

| # | Step | Who / what | Live? | Cost |
|---|---|---|---|---|
| 1 | **Record** a new site once, all the way to the form; re-record only on a signal | skill `record-applying-sites`; `record-sites.yml`, whose single job is recording | ✅ the only live step | cents per row |
| 2 | **Detect**: replay every recording on the build | CI: `site-replays-pr.yml` on every PR, `site-replays.yml` nightly → `/admin/lab-form-filling` | no | $0 |
| 3 | **Fix** the top 🔴 row | skill `/fix-recorded-sites` | no | $0 + the fix session |
| 4 | **Verify** the fix | CI after merge: "Confirmed offline" on the Fixed tab (2 agreeing replays) | no | $0 |
| 5 | **Benchmark** (occasional) | bake-off: the extension vs other agents on the same forms (repo job-pilotto-bakeoff) | yes | dollars: owner's OK |

## The signals that start each step
- **Record (1):** a new site on the pool list; installs' outcomes on a job board dropping against its own last 14 days (counts only, k ≥ 3); a person's report;
  a "Blind spot" on the platform scorecard (real fills miss what the pool reaches: record that site).
  Never a schedule. A replay that changed is our build, never a reason to re-record.
- **Fix (3):** a 🔴 row on `/admin/lab-form-filling` → Fixes → Needs a fix (one status per row: 🟢 works · 🟣 held on purpose · ⚪ site problem · 🔴 needs a fix).
  A "regression" row says whether it is **Our build** or **Site changed** (the same recording replayed on two builds).
- **Verify (4):** a merge. "Needs a recording" means the fix took a route the recording never had: re-record that row with the full journey (step 1).

## What a step never does
- Never Submit, never a captcha or bot check, never past a login wall, never read a password field; the fake applicant only; the privacy tripwire on.
- At most 3 live visits per host per day (CI's ledger: a by-hand run uses 1 of 2).
- No site names or hosts in code, tests or PR bodies; a fix is universal and lands with a recorded case that fails on the old build.
- No live run to test or to prove a fix; no AI spend without the owner's OK and a measured cost.
- No many-row replay on the Mac: a before/after over more than 3 rows runs in CI (`gh workflow run site-replays.yml --ref <branch>`, ~14 min in parallel, $0; owner, 15 Oct 2026); `replay-records.mjs` refuses it locally (`desktop/e2e/lib/wide-local.mjs`).

## An intended replay drop: accepted on the PR (owner, 14 Oct 2026)
- A fix can make a counted row "worse" on purpose (an upload counted once, not twice). The PR gate's summary shows that row's **field-by-field diff** (label, baseline outcome, PR outcome; never a value) and a copy-ready line.
- The owner labels the PR `replay-accepted` and comments `Replay-accept: <row name> — <reason>` (or a bare `Replay-accept: <reason>` for every worse row). The gate **re-judges by itself** (`site-replays-accept.yml` re-runs the failed verdict and "all checks green"; no replay re-run, $0) and passes only the named rows; any other worse or unfinished row stays red. After the merge the nightly moves the baseline (`replay-accepts.mjs`).
- **Never accept your own drop.** Every session posts as the owner, so its comment would count as the owner's. Show the owner the gate's diff and wait; the hook `tools/replay-accept-guard.py` blocks the post unless the command has `REPLAY_ACCEPT_OK=1`, which you set only when the owner asked for that accept in your own chat.

## App bugs (not form bugs)
The Desktop App's own screens (session cards, review panel, tabs) are not in the replay. A bug you see yourself → skill `desktop-change`
with a test in `desktop/test/app-scenarios.test.js`. The twin (docs/live-test.md) reproduces it on demand; it is never a loop.

## Skills for this workflow
| Skill | Step | State |
|---|---|---|
| `record-applying-sites` | 1 | renamed from the pool-running skill (15 Oct 2026), recording only |
| (the filling-review skill, retired) | 1 | folded into `record-applying-sites` as the real-use signal |
| `fix-recorded-sites` | 3-4 | offline loop, under 150 lines (renamed 15 Oct 2026) |
| `apply-to-job` | not testing: the instructions the app gives Claude when it finishes a page (rung 5), a backup we aim never to need | kept |
| `desktop-change` | app bugs | kept |
| ~~the live twin loop skill~~ | removed 14 Oct 2026 | — |

## Refilling answers a prompt change made stale (15 Oct 2026)
- A PR that changes what the app asks the AI turns pinned rows "ask changed" / "out of date" in the site replays gate. Refill them in CI, not on the Mac: run the workflow `CI · Replay refill (by hand)` (`gh workflow run replay-refill.yml -f pr=<n>`) or label the PR `refill`.
- Its own key `REPLAY_REFILL_ANTHROPIC_KEY` (no fallback), a cap (40 asks, $3), the estimate first, the spend in the job summary and on /admin/ai-cost (`replay-refill`). Old answers are never changed. `npm run fill-memo` stays for one row on the Mac.

<details><summary>Gaps being closed (14 Oct 2026) and where</summary>

| Gap | Where |
|---|---|
| "Confirmed offline" and the regression verdict (Our build / Site changed) | job-pilotto-8e PR; bisect to the first bad commit next |
| The pool becomes a recorder; skill rename; re-record signals on the page | job-pilotto-cf, spec `docs/superpowers/specs/2026-10-15-record-once.md` (A) |
| A CI recording never updates the pool table (`applying-report.mjs` refuses CI) and must reach the replay's records | job-pilotto-cf (A), its first PR |
| Rules, skills and e2e pieces that required a live proof (B1: e2e, workflow, docs; B2: the site's live-proof store and column) | job-pilotto-70 |
| Recording past where the extension stops (full journey) | job-pilotto-cf (C) |
| `fix-recorded-sites` still describes live runs, the heavy lock, `npm run row`, `twin:drive` | job-pilotto-cf (B) |
</details>
