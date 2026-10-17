# The apply-flow workflow: record once, work offline

> **Verdict (owner, 14 Oct 2026):** we record each site once and do all testing, fixing and verifying offline ($0).
> Live visits happen only to record. You start step 3; the coordinator (job-pilotto-cc) routes; the rest runs by itself.

| # | Step | Who / what | Live? | Cost |
|---|---|---|---|---|
| 1 | **Record** a new site once, all the way to the form; re-record only on a signal | skill `record-applying-sites`; `record-sites.yml`, whose single job is recording | ✅ the only live step | cents per row |
| 2 | **Detect**: a small daily replay (~7 rows, one per kind of form users meet) | CI: `site-replays.yml` once a day, never on a PR → `/admin/lab-form-filling`; Telegram only on a worse outcome | no | $0 |
| 3 | **Fix** the top 🔴 row | skill `/fix-recorded-sites` | no | $0 + the fix session |
| 4 | **Verify** the fix | CI after merge: "Confirmed offline" on the Fixed tab (2 agreeing replays) | no | $0 |
| 5 | **Benchmark** (occasional) | bake-off: the extension vs other agents on the same forms (repo job-pilotto-bakeoff) | yes | dollars: owner's OK |

## The rule for recordings and replays (owner, 17 Oct 2026: "Yes, adopt it")
- **Recordings are a debugging tool, not a gate.** A failure (a person's "Report this form", the daily replay, a bake-off row) → record THAT one site once →
  reproduce and bisect offline (`npm run row`, seconds, $0) → fix → **freeze it as a page case** (the PR guard: it never goes stale). **Every bug a replay finds ends as a page case.**
- **Keep small:** the daily replay ~7 rows (one per kind of form users meet), alert only on a worse outcome; refill and re-record only the rows the daily run flags
  (a row whose re-record will not reproduce is dropped); the bake-off is a monthly trend; journeys run daily for the multi-step flows.
- **Daily set leans on multi-step flows** (owner, 17 Oct 2026): Richemont Workday, signed-in SuccessFactors and the like first, then one row per kind of form; journeys stay for these flows (no 1 Nov cut). Unpinned rows stay recorded: offline replay and bisect still work, they only leave the daily set.
- **Weekly discovery batch:** ≤ 5 NEW hard sites a week (Workday, SuccessFactors, SAP, Taleo, iCIMS…; ~$0.30), recorded in CI (`record-sites.yml`), replayed offline, what breaks is fixed and each bug is frozen as a page case. By hand from the coordinator unless the owner asks for a weekly schedule. Account-creation flows use per-tenant test accounts the owner creates (Keychain / GitHub secrets); never Submit, no captcha.
- **Stop:** replays or journeys on PRs; a refill after every merge that changes a prompt (there is none: the daily run starts it for the rows it flags); many pins kept current;
  red runs over AI wording; re-recording forms nobody uses.
- Why: [why.md](why.md) "Recordings are a debugging tool" (0 real PR catches in ~300 runs, 10 of 37 recordings stale in a week, 1 real catch offline).

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

## An intended replay drop: accepted on the PR that causes it (owner, 14 Oct 2026; since 17 Oct 2026 the daily run judges it, no PR gate)
- A fix can make a counted row "worse" on purpose (an upload counted once, not twice). The daily run's summary shows that row's **field-by-field diff** (label, baseline outcome, new outcome; never a value) and a copy-ready line.
- The owner labels the PR `replay-accepted` and comments `Replay-accept: <row name> — <reason>` (or a bare `Replay-accept: <reason>` for every worse row). The daily run (`site-replays.yml`) reads the label and comments of the PRs merged since its baseline (`replay-accepts.mjs`) and passes only the named rows; any other worse row stays red and alerts.
- **Never accept your own drop.** Every session posts as the owner, so its comment would count as the owner's. Show the owner the gate's diff and wait; the hook `tools/replay-accept-guard.py` blocks the post unless the command has `REPLAY_ACCEPT_OK=1`, which you set only when the owner asked for that accept in your own chat.

## App bugs (not form bugs)
The Desktop App's own screens (session cards, review panel, tabs) are not in the replay. A bug you see yourself → skill `desktop-change`
with a test in `desktop/test/app-scenarios.test.js`. The twin (docs/live-test.md) reproduces it on demand; it is never a loop.

## A bug the owner saw is proven on his own page (owner, 16 Oct 2026)
- Why: #941 (SAP select) was proven on a fixture written from vendor code and failed live; #972 passed unit tests and did nothing in the browser.
- The owner's ⚑ report: `node desktop/e2e/reports-fetch.mjs <records dir>` -> `reported-<id>-<site>`; `npm run row-to-case -- "reported-<id>-<site>" <case> --old-commit <sha>` writes a case with `"origin": "captured"` and `"report": "<id>"`.
- The fix's commit says `Owner-report: <id>`; the case must FAIL on main ("New test pages fail on the old build") and pass on the fix. A commit that says the owner saw the bug (or ⚑, "Report this form") without the trailer is refused: `tools/owner-report.mjs` (fast checks).
- `origin: "hand-cut"` (written from vendor code or a sketch) never proves an owner-seen bug. No ⚑ capture shows it: `Owner-report: none <why>`.

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
- A merge that changes what the app asks the AI turns pinned rows "ask changed" / "out of date" in the daily site replays. There is no refill after each merge: the daily run starts `CI · Replay refill` itself for just the rows it flags (`only`), or run it by hand (`gh workflow run replay-refill.yml -f only=<row names>`); never from a PR (no PR-started workflow may reach an AI key). A row whose re-record will not reproduce is dropped, not chased.
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
