# Faster fixes: the corrective actions of the four fix post-mortems (11 Oct 2026)

**Why:** four pool fixes (Hornbach, Datadog, Swatch, jobs.ch) took 60 to 90 minutes each. Post-mortems of job-pilotto-54, -eb, -3b and -81
(scratchpad, compiled by job-pilotto-cc): ~40% a wrong first guess (the first run did not show what the AI was asked and answered), ~20% a
repro tool not on the app's path, ~25% waiting (e2e page, file claims, version race), ~15% landing (gate reruns, load flakes, baseline conflicts).
**Target:** about 20 minutes per fix: read the evidence and diagnose in minutes, fix and test locally in ~10, one gate run of ~5.
**Progress:** `node tools/ladder-progress.mjs --spec docs/superpowers/specs/2026-10-11-faster-fixes.md` (a box is ticked only with its landed hash).

## Progress

### 1. The first run shows the evidence (wrong first guess, ~40%)
- [x] The AI's live requests and answers saved per run: `ai-calls.json` (job-pilotto-b8, 3cc8788)
- [x] The digest's own answer and what was dropped in the app log (job-pilotto-eb, 94d4d59)
- [x] The press trace: where a press went (job-pilotto-54, 0.9.184)
- [x] One evidence bundle per pool run, its four lines quoted in the report (job-pilotto-b8, d46864d)
- [x] A killed or cut-short run uploads nothing (job-pilotto-b8, d46864d)

### 2. Reproduce on the app's real path (~20%)
- [x] Live ladder-score asks through the app's own AI adapter (job-pilotto-eb, a322751)
- [x] The digest score prints the raw answer, press_kind and drops (job-pilotto-eb, 6c69ef2)
- [x] Every accepted extra outcome of a fixture states its reason (job-pilotto-eb, bce6a6d)
- [x] The stored answers re-recorded on the app's path (owner: "re-record"; job-pilotto-eb, dba133b)
- [x] ladder-capture builds a fixture from a run's ai-calls.json (job-pilotto-eb, ebb1154)

### 3. No waiting in line (~25%)
- [x] A claim per pool row (job-pilotto-81, d901855)
- [x] Pool and live runs have their own SQLite store and artifacts folder; the real Notion page has a lock for notion-real only (job-pilotto-90: d6f6e1e, ca656bb, 07c63a4). Workers: not built, memory first
- [ ] Per-function claims on flow-core files (job-pilotto-81)
- [x] The extension version taken at ship time, after the rebase (f99fb46)

### 4. Faster landing (~15%)
- [x] A failed recorded case is retried alone and reported FLAKY with the load (job-pilotto-cc, c912b8b)
- [x] Two sessions' baseline updates merge without a conflict (job-pilotto-cc, d5503ae)
- [x] Heavy runs wait when the machine's load is high (c93ed10)
- Dropped (11 Oct, job-pilotto-ac): A one-minute local check before the gate (the touched area's unit tests, e2e harness tests) — it repeats the gate's own tests, and sharing the gate cache from a working tree with git-ignored leftovers is unsound

### 5. The skill (fix-failing-forms)
- [x] Asked / answered / done before any guess (e87c82a)
- [x] Skip rows that are not failures; check main for a landed fix (e87c82a)
- [x] Claim files only once the cause is proven (e87c82a)
- [x] An app-side fix's control: a failing unit test plus the real AI answer (e87c82a)
- [x] A prompt line reaches only its shape, with its own fingerprint key (e87c82a)
- [x] One row per session; side work goes to a new session (63e188c)

### 6. Landing speed (landing-speed session)
- [x] 1. Timing: every gate step timed, log in the git common dir, top steps printed (be0269c, afdd1f8)
- [x] 2. Cache by content: a suite that passed on the same inputs is not run again (Stop hook reads it too) (856ecbb)
- [x] 3. One heavy run at a time per machine (lock) and heavy runs wait when the load is high (c93ed10)
- [x] 4. Tiers: docs, skills, tools-only and tests-only pushes run lint + touched unit tests only (db0c63a)
- [x] 5. Landing lock in ship.sh, and the extension version taken at ship time under it (f99fb46); the lock made opt-in, a refused push re-checked instead (owner, 11 Oct)
- Dropped (11 Oct, job-pilotto-ac): 6. A one-minute local check before the gate — it repeats the gate's own tests, and sharing the gate cache from a working tree with git-ignored leftovers is unsound
