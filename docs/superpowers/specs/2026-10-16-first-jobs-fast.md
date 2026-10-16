# First jobs fast: a new user's first minutes (16 Oct 2026)

Owner (16 Oct): after the wizard the Jobs screen is empty, "Refresh jobs" is a tiny link, the run hides in Recent activity, first jobs come after ~5 min,
and "Find new employers" is one of 6 Actions he cannot find. "He is lost." Goal: **one big button, live progress on Jobs, first job in 10-30 s,
one action "Find jobs" instead of two.** Tier 2 (engine + store writes).

## Verdict
- 🟢 Streaming first slice: a few fast feeds, 3 jobs scored at once, the first one listed the moment it is saved. Rest of the run unchanged.
- 🟢 One "Find jobs" = crawl + score first, then grow employers (scout) at the end of the same task.
- 🟢 Jobs screen gets a progress card on top (live lines, list grows below it).
- ⚪ Same total AI calls as today (scored jobs are skipped by their hash; the second crawl re-reads the same feeds, no AI).

## What exists today (history read)
| Piece | Where | History |
|---|---|---|
| First search after the wizard | `finishSetup()` strategy-review.js:354 → IPC `firstSearch` (jobs-handlers.js:43) → `pipeline.refresh(..., 'first')` | built with setup; **it already starts**, but shows only a one-line `#search-status` and the list stays empty |
| Search = `discover` (5 pages, 40 cos) then `daily --mode run` | pipeline-tasks.js `searchOnce` | |
| Batch end to end | `daily_search.py` `time_budget.batch('score')` | 7 Oct "a batch should handle it from start to finish": **unscored jobs are not listed** (`hide_unscored`, test_refresh_batch.py) → nothing shows until ≥10 scores (`on_scored every=10`) |
| Crawl before any scoring | `feeds.scan(feed_list)` all sources, then titles/places triage (AI) | 3 min budget (7 Oct) |
| Find new employers | `pipeline.scout`, Actions "Step 1" (index.html:583), onboarding.js hint, schedule.js own timer | 3 min soft limit (78ffd1a); "Few new jobs" nudge suggests it (100a19b, e4fcf63) |
| Empty Jobs text | index.html:370 `#jobs-empty` "Click Refresh jobs; takes a few minutes" | |

So the real gaps: (1) nothing is listed until a whole batch is scored, (2) the crawl reads every feed before the first score, (3) no big button / no
progress on Jobs, (4) two actions.

## Timings: measured (tools/first-jobs-measure.py, 16 Oct 2026)
Same harness on main (`first-jobs-before` = origin/main 7f0b8dd) and on this branch: the real engine (`python -m src daily --mode run`), a fresh fictional SRE
profile, this Mac's store in a temp folder, the e2e fixture boards (nothing leaves the Mac), **the CLI engine on the owner's Claude plan** (no API key).
Time = seconds from the engine's start to the first row in the store.
| Run | First job in the store | First scored job | Engine ended |
|---|---|---|---|
| 2 feeds, 6 jobs (the bare fixture): main | 14.7 s | 19.1 s | 34.0 s |
| 2 feeds: this branch | 18.3 s | 23.3 s | 33.1 s |
| **120 feeds, each answers in 2 s, 8 at a time: main** (2 runs) | 47.3 / 45.2 s | 52.3 / 50.5 s | 67.0 / 71.8 s |
| **120 feeds: this branch** (2 runs) | **18.6 / 17.7 s** | **23.6 / 24.2 s** | 71.8 / 68.1 s |
- With a crawl that has a length, the first job comes **~27 s sooner** (46 → 18 s) and the first score **~28 s sooner** (51 → 24 s); the whole run takes the same time.
- With no crawl to skip (2 feeds) there is nothing to gain, and the slice costs a few seconds (noise of one Claude answer is ±5 s): the first 15-20 s are the
  AI places/titles triage and one score call, in both.
- 120 × 2 s is a short crawl: the owner's real one is ~180 s (212 feeds, slow careers pages, Workday), so the gap there is larger. That is a model, not a run.
- The fictional profile and boards come from the repo; one feed answer is simulated by a sleep (the same on both sides); AI answers are real.
- Correction of the first draft: on this Mac's own store a score is listed the moment it is saved (the "every 10 scores" only paces the Notion sync), so
  "today" is the crawl + triage + first score, not 10 scores.

## What was built (differences from the first draft)
- `src/first_jobs.py` + `--first-jobs` (daily_args, daily_search): slice of 15 feeds (fast JSON kinds first), 3 jobs scored 3 at a time, `on_scored` after every score
  (sync to the store's Job Matches). A failure there is a warning; the full search does everything the slice did. The slice's jobs count as "seen" in the
  full run's `new` count (a first run reports fewer new jobs than it listed).
- Triage of the slice's jobs stays (cached, one small call), so the slice is a few seconds longer than "no AI".
- `desktop/lib/search-steps.js`: first run = `daily --first-jobs`, then `discover`, then a light `daily --mode today` (imports the boards' jobs and scores them),
  then the finder. Later runs: `discover`, `daily`, finder when due. **Finder due** = first run, or a press of Find jobs when none ran in the last 24 h
  (`scoutDue`); never on a schedule that has its own (Always on). The finder is off by default for new installs (a central scout feeds the index): Find jobs
  now does what the Actions card did, once a day at most.
- The jobs list shows unfinished jobs as **Scoring…** until the first search ends (`jobs --first-run`); the "N jobs are not scored yet" warning waits.
- `renderer/find-card-model.js` + `pages/jobs-find.js`: the card, five states, built from the shared header, number strip, pills and rows.
- Left out on purpose: Always on's `scout.yml` and its schedule row (Settings → How often, now "More employers"), the Notion run Mode names
  (`Refresh jobs`, `Find new employers` in src/notion: schema values), the engine's own CLI names (`scout`). The scheduled finder's runs are called "More employers".

## One action "Find jobs"
Merge **Refresh jobs** (kind `search`) + **Find new employers** (kind `scout`) everywhere they live. Siblings to fix in the same change:
| Place | Change |
|---|---|
| Jobs header `#refresh` (index.html:302) | big "Find jobs" on empty; normal button after |
| Actions "Step 1 Find new employers" (index.html:583) + the card for refresh | one card "Find jobs" |
| Settings task row (index.html:1088) | removed/merged |
| ⌘K palette | one entry "Find jobs" (+ old words as aliases) |
| onboarding.js tasks + `scoutHint` | one task; hint text drops "run Find new employers" |
| Recent activity names (`KIND`), run-status.js, run-cards.js, few-jobs help | "Find jobs"; scout stays a sub-step line in the same run |
| schedule.js scout timer | the scheduled search runs the scout when due |
| Telegram texts, tray/menu, README, site pages, e2e suites, gallery | grep list in the PR, all renamed |
Kept: the Recent activity record (one run row; the scout part as its own lines); engine commands `scout`/`daily` stay for CLI and cloud.

## Jobs screen states
| State | What shows |
|---|---|
| empty-first-run | big card: "Find my first jobs" button, one line what happens ("first matches in under a minute") |
| searching | progress card **on top**: stage chips (Looking → Scoring → Reading all employers → Growing your sources), live lines from the run log, count; list grows below |
| done | card shrinks to one line ("Found 23 · 4 min ago") with Find jobs again |
| failed | card in warn tone: the reason in words + the one thing to do (Open Claude settings / Try again) |
| later visits | small header button and last-search line as today; no card |
Reuse: `.run-card-title/-stats/-row`, `.callout`, empty-state, chips from components.js; new CSS only for the card's root. Rendered and shot in demo mode for
every state; Recent activity row still written.

## Tests (first, watch them fail)
- `desktop/test/app-scenarios.test.js`: wizard done → Find jobs → first job row in the store and in the list **before the batch ends** (fake engine that prints the
  slice lines, then waits).
- tests/test_first_jobs.py: slice picks fast ATS + best places first; first save triggers a sync; same AI call count as without the flag; unscored listed in a first run.
- A loop test over the action siblings (palette, Actions, onboarding, KIND names): no "Find new employers"/"Refresh jobs" label left.
- e2e step that clicks "Refresh jobs" updated in the same commit (jobs, activity, employers, pool suites).

## Progress
- [x] Spec to cc (proof: docs/superpowers/specs/2026-10-16-first-jobs-fast.md)
- [x] Measured first-job time before/after (proof: tools/first-jobs-measure.py)
- [x] Engine: `--first-jobs` slice, early save/sync, unscored listed in a first run (proof: tests/test_first_jobs.py)
- [x] App: first search passes the flag; finder merged into the search task (proof: desktop/test/search-steps.test.js)
- [x] Jobs screen: states + progress card + big button, shots of each state (proof: desktop/test/find-card.test.js)
- [x] Merge the two actions in all siblings, with a loop test, docs/README (proof: desktop/test/find-card.test.js)
- [x] e2e steps updated, finder started through `pilot.command('scout')` where a suite judges it alone (proof: none: e2e runs on CI only, not run locally)
- [ ] PR green, reported to cc
