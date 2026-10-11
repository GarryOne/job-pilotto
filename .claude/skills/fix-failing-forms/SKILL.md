---
name: fix-failing-forms
description: Fix the applying flow's failing or low-reaching shapes one at a time, from the smoke pool's results (/admin/applying and the QA smoke-reports). For each shape, reproduce it in the e2e harness with fake applicant data, say which part of the self-improving mechanism the fix improves, fix it for every site, add a recorded page that fails on the old build, land with tools/ship.sh and re-run to confirm it reached further. Use when the owner says "fix failing forms", "/fix-failing-forms", "fix the pool's worst sites" or names a shape that stops early (e.g. Workday "Start Your Application"). Also the fix for a page that stops at "posting"/"no-form", has no apply route or was classified wrong: the rung method (the rung of the ladder that decided wrong, the smallest fix, `npm run ladder-score`); one command for every applying failure.
---

# Fix failing forms: one shape at a time, from the pool's numbers

Goal (owner, 9-10 Oct 2026): from the posting to a filled form, stopped before Submit, on any site, and **never fix the same website twice**; one failure at a time: validate, fix, close, score.
This skill works on the pool (real postings, layer 3 of `docs/superpowers/specs/2026-10-10-applying-reliability-layers.md`). Live sessions on the
owner's twin are `fix-live-applying-in-twin`. The pool's own upkeep (running, growing, coordinating it) is the skill `run-applying-smoke-pool`, which hands failing shapes to this one.

Where the next shape comes from: the platform scorecard on `/admin/applying` names the platforms to fix, in this order: **Weak in both**, **Blind spot** (start with `improve-filling` to see what real fills miss),
**Test failing**. **Not in the pool** is `run-applying-smoke-pool`'s to add first. Rank by "Of matched jobs": the most-used platform that fails comes first (skill `run-applying-smoke-pool` "Reading real use").

## 0. Before starting (one line each to the owner)
- **The list is the page's "Needs a fix" section** (right under the tiles of `/admin/applying`; owner-only; Bearer = Keychain `job-pilotto.site.api_key`, see memory
  `reference-owner-pages-access`; the same rows are in the page's `?json`: pool rows with `regression`, `short`, `shares`, `reached`). It is worst first: regressions, then the earliest
  stop, then the least filled form. A form reached with under half of the asked fields filled is a **shortfall** (red "form · 4 of 12"): a failure, not a success. A code or bot check is a documented
  hold and is not on the list. Take the TOP row **that no other session holds**, one shape per round: go down the list and, for each row, `node tools/claim-shape.mjs claim "<row name>" --session <your session name> --alive <the names `ListAgents` shows, comma-separated>` (exit 0 = yours; exit 1 prints the holder: go to the next row). A claim is a file per row in the Mac's QA folder, so several `/fix-failing-forms` sessions in parallel never take the same shape; it goes stale after 6 h or when its session is gone from `ListAgents`. `node tools/claim-shape.mjs list` shows who holds what. **Release it** (`release "<row name>" --session <you>`) when the row is confirmed cleared, or when you stop or hand the shape back. Its evidence is on this Mac: `~/Library/Application Support/Job Pilotto QA/smoke-reports/` (`<day>.json` with each
  site's `fieldList`: label, type, outcome, required, reason per field; one `.log` per run) and **`replay-candidates/<day>/<shape>/`** (the failing run's last page, structure only and scrubbed, with a
  `case.json` skeleton: the run's fields, page path and page-kind lines): start the recorded page from that candidate, take the AI's answers from its `evidence`, never invent them.
  **Skip what is not a failure:** an email/told outcome (a correct hold), a site answering 5xx (note it), a row already fixed on main (`git log origin/main --grep '<site>'`, `Pool-row:` trailers): 3 of 4 top rows were these on 11 Oct.
  Say: N rows, the top three, the one you take. After the landing, the next night's "Filled, last runs" column of that row is the proof: it must go up or the row must leave the list.
- **Take a CAUSE, not a row** (owner, 11 Oct 2026: a 3 h round of 6+ sessions, one per row, confirmed 2 rows; [docs/rules/rounds.md](../../../docs/rules/rounds.md)). Read the
  **By cause** tab of `/admin/applying` or `node tools/needs-fix-causes.mjs --rows` (the Needs-a-fix rows grouped by top cause; `node tools/needs-fix-order.mjs` is the plain order).
  1. **"Run first" is not yours:** a row never run, or with no run since its fix, needs a pool run, not a fix (11 Oct: 10 of 29 had never run). Hand the list to the pool owner (`coordinator.txt`).
  2. **Weigh by demand:** `/admin/applying`'s scorecard ("Of matched jobs") says which platforms real users apply on (11 Oct: Greenhouse 55%, Ashby 34%, the rest 0-3%); a cause on a 0-3% platform waits unless generic and cheap, and a big platform filled well under its pool result (Ashby "Blind spot") goes first.
  3. **Take the biggest cause no session holds:** claim every row of it (`node tools/claim-shape.mjs claim "<row>" ...`; exit 1 on one: take the next cause). "No cause recorded": read the
     row's evidence (1.1, ASKED/ANSWERED/DONE) and name its cause before fixing.
  4. **Your target is rows confirmed by a pool run** (Fixed tab "Confirmed"), never "fix landed" or "recorded page passes". Ask the pool owner to run your shapes on your build and go idle;
     report confirmed rows of your cause, before -> after, when you stop.
- **Peers (a courtesy, never a dependency; owner, 11 Oct 2026: "run on its own, without a coordinator"):** `ListAgents`; `coordinator.txt` in `~/Library/Application Support/Job Pilotto QA/` names the session
  owning the pool's run queue, if one runs. Never two runs at once: the heavy lock queues them, a peer's run holds it, wait. **No coordinator in `ListAgents`, or the lock free: you run everything yourself** (repro, re-run on the landed build, upload) and say so in one line; never stop to ask.
- **Claim the flow core** (`FLOW_CORE`/`FLOW_FILES`, `desktop/e2e/flows.mjs`) **only once the cause is proven (1.4), never on a hypothesis** (11 Oct: a claim on a guess queued 3 sessions), before editing any file in it: one message to every peer "I own the flow core
  until I say released", and "released" when done. Read each file's `Invariants:` block first; changing one is the owner's call, said in the commit.
- **Worktree:** `tools/worktree.sh fix-<shape>`, own scratch folder `<scratchpad>/fix-failing-forms/`. No subagents. Say the change tier (usually Tier 2: apply flow). **One row per session:** side work asked mid-round (a tool, a skill rewrite, a peer's request) goes to a new session with a brief unless it takes under ~15 min (11 Oct: one row doubled a session).

## 0b. Which kind of failure is it? (decide before reproducing; the owner types one command and never chooses)
- **A rung problem**: the page was judged or climbed wrong. The row says "stopped at the posting" or "no-form", the log's `page kind:` line is wrong for what the page really is, or there was no apply route. Method: **3b**.
- **A field problem**: the page was read right (the form was reached) and fields stayed unexplained ("form · N unexplained of M"): a field not filled, a control not operated, a question text not read. Method: **3a**.
- **A lost answer** (a `page kind:` line `by structure rule`, no confidence, in under ~3 s): the extension got no answer from the app. Not a rung problem yet: compare the extension line with the app's line for the same request (step 1.1) before touching any rung.
- **Stale row**: the row's `version` is older than main's `extension/manifest.json`, or a later run of the shape reached further: check `smoke-reports/` for a newer run before building anything (10 Oct 2026: Hornbach reached the form on 0.9.178 and 0.9.179).
- Both on one site: fix the rung first (the form is never reached otherwise), re-run, then the fields. Say which kind it is in one line before you start.

## 1. Reproduce (small, isolated, with a positive control)
1. **ASKED, ANSWERED, DONE before any hypothesis** (owner, 11 Oct 2026: ~40% of each fix went to a wrong first guess). Write three lines from the run's evidence: ASKED (the sketch: buttons listed, candidates, frames, digest flag), ANSWERED (`page kind:` with `formFrame`, the `digest:` line: outcome, verb, numbers, dropped), DONE (what was pressed, where the page went: 54's press trace). A hypothesis that does not explain all three is not a diagnosis; a missing line is step 1.4b. **Read the artifacts, in this order:** (a) `smoke-reports/<day>-<shape>.app.log` (the app's whole log, kept per run; older runs: the e2e app's `jp-e2e-*/logs/app.log` in the temp folder, by time and host):
   `page kind:`, `page kind: none (<error>)`, `ladder:`; (b) the shape's `.log` (the extension's `fill:` lines, the STALL dump with `controls` and `buttons`); (c) `live-frames/*.png` (check the host in the log vs the picture: the folder is overwritten);
   (d) the report's reached step. **Pair each extension line with the app's line for the same request** (an extension answer with no app line: the request never arrived or the extension returned first).
   **`grep` the code for a log message before adding one** (a duplicate was written once).
2. **Run it in the harness, never the twin, never the owner's data:** `cd desktop/e2e && npm run smoke -- --only <shape words>` (the e2e app, its own profile and
   SQLite store in a throwaway profile (no Notion), fake applicant, fixture CV, a headless Chrome with the real extension through `lib/extension.mjs`). It is a HELD run: the consent and the
   account button are NOT pressed, never Submit. **Say before it starts** what the window does and what is HELD, and how long (`SMOKE_SECONDS`, default 90).
3. **Watch it with `Monitor`, not sleep** (global rules): background run to a log, then
   `tail -n 0 -F <log> | grep --line-buffered -E "^\s+live \+|STALL|\[extension\] (fill: (page kind|pressed)|can't reach)|^(✓|✗)"`. Test the pattern once with `grep -c`
   on the log so far. Each event: one line on what it shows (progressing / done / stuck). First sign of life within ~20 s or say the experiment failed.
4. **Prove the repro: two hard rules.** (a) **The SAME signature:** a repro counts only when it shows the same log lines as the live failure (the same `page kind:` and `ladder:` lines); one that fails for another reason proves another bug
   (Datadog: the frame did grow, but the AI had answered "form", which cannot carry `form_frame`, so a real but different blocker came first). (b) **Which blocker?** Before any fix the log must answer it; if it cannot (frame count, `form_frame`,
   digest flag, the named button's flags: `no Apply button to press {found, visible, pickable…}`), add that line, run once, then fix. Also: the stub was really called (count the asks), and the case FAILS on the build before the fix
   (`REAL_EXTENSION_DIR=<old extension/>`); one that passes there is only a guard. **Which layer proves what:** a hand-stubbed AI answer in a recorded page proves the extension handles a CORRECT answer, never that the model gives it
   (that is `ladder-score` and the live pool). A shape that fails once (a moody site) is run twice before it counts.
5. **Offline, no app run, seconds:** `cd desktop && node scripts/stage.mjs` once per fresh worktree (builds `shared/`), then `npm run ladder-score -- --offline --only <fixture>` (what the stored AI answer says) and
   `cd e2e && JP_REPLAY=1 REPLAY_ONLY=<case> node --test test/recorded-pages.test.mjs` (the real extension on a recorded page). The shared e2e page is a queue (the coordinator, `coordinator.txt`): read the offline result and the newest logs first.

## 2. Say what the fix is, before coding (one block)
- **Which part of the mechanism it improves** (docs/rules/applying.md "A form bug is fixed in the self-improving mechanism"): an operator, the fingerprint, a meaning in the
  pack, a recipe (data), the page-kind AI's fixed answers, or noticing the miss. Prefer **data** over code; a code fix says why data could not do it.
- **Which of its decisions are AI, structure, floors** (CLAUDE.md "Judgments about a page are the AI's"). A heuristic (word, vendor, regex, "the element vanished")
  becomes an AI field with a fixed answer the code validates.
- **The shape, not the site:** "a start dialog before the form", "a cookie banner over the dialog", not "Workday". List the sibling shapes and sites it also helps
  and what it does not cover. A variant the fix cannot handle is reported with its fingerprint and listed for the person, never skipped silently.

## 3a. A field problem: fix with the recorded page first
1. **A recorded page that fails on the old build** (layer 2, `desktop/e2e/recorded/<shape>-<n>/`): capture the real page (`twin:drive capture` only from a twin
   the owner runs; otherwise record the page from the harness run's DOM, scrubbed: no values, no scripts, no query strings, no personal data;
   `desktop/test/recorded-privacy.test.js`). **Its AI answers must be what the real AI answered in the failing run** (from the log / decisions), **and only to what the extension asked** (the `asked` check reads the /extension/answer request's fields; a stub that answers an unasked question lets the old build pass), never an answer
   written by hand to make the case pass (10 Oct 2026: `workday-start-dialog-1` was given `applyButton: "Apply Manually"` by hand, the live AI answered "Apply").
2. Run `cd desktop/e2e && npm run recorded` against the build from before the fix (`REAL_EXTENSION_DIR=<that build's extension/>`): it **must fail**; then on the fix: pass. Write what you saw into the case: `"control": {"build": "<the older extension version it failed on>", "failed": "<the failing check>"}` in its case.json; without it (or `{"guard": "<why it cannot fail on an old build>"}`) the run uploads no row to /admin/applying.
   **An app-side fix (extension unchanged) cannot fail a recorded page on the old build:** its control is a unit test failing first plus the REAL AI answer (`ladder-score` live or `ladder-digest-score`); its recorded page is a `guard`.
   Also a journey scenario in `desktop/test/journeys.test.js` when the logic of the flow changes (failing first).
3. Fix the root cause through the shared mechanism for the whole class; every sibling in the class in the same change. File size <= 500 lines.
4. After a fix to form filling, also `cd desktop/e2e && npm run real-extension` (isolated; positive control with `REAL_EXTENSION_DIR`).
5. New wording the AI sees: update the website's Intelligence page and count (CLAUDE.md), if a user can see a new AI step or rule.

## 3b. A rung problem: the lowest rung that has the information, data first
Map: `docs/flows/ladder.md` (rungs, owners, fixed answers, what may change). Spec: `docs/superpowers/specs/2026-10-10-ai-ladder.md`. Rule of the product: **never fix a website; fix a shape.** The site is one live sample.
Non-negotiables (the ladder designer's, job-pilotto-cc): the rung map first; the failing page captured as a fixture BEFORE the fix (`node desktop/e2e/ladder-capture.mjs`, seen wrong); the smallest fix at the lowest rung that has the information, data before code;
`npm run ladder-score` live and `--offline`; the baseline updated only with `--update-baseline "<why>"` (never edit an expectation to pass); a recorded page that fails on the old build; the commit trailers `Rung: <n>` and `Fixture: <id>`.

### R1. Find the rung that decided wrong (5 min, no edits)
- `/admin/applying` pool table "Rung" column, or `logs/app.log`: `page kind: <kind> by ai|remembered`, `structure rule`, `closer look`, `takeover`.
- Map: by `ai` = rung 2, `remembered` = 1, structure rule = 0 (after unsure or no AI), digest = 3 (read its own answer: verb, numbers, what the app DROPPED), closer look = 4, takeover = 5.
- Say in one line: "decided at rung N, said X, truth is Y, because <the sketch shows / lacks Z>".
- Look at the sketch the rung really saw: `cd desktop && node e2e/ladder-capture.mjs --dir <scratch dir with one fixture json>` (read-only GET, bare Chromium) or the fixture of that shape in `desktop/e2e/ladder-fixtures/`.
  The usual causes: the Apply control is not in the first 20 buttons (navigation crowds it out); the page is a frame (`frames` only); the instruction is in text the sketch does not carry.

### R2. Make the case a fixture first (it must fail or be wrong-and-confident)
- Add `desktop/e2e/ladder-fixtures/<shape>.json` (`source`: captured for a real page via `capture.url`; invented/reconstructed for a shape written as `pages/<id>.html`), `expect.outcome` from the real page, `accept` only for what the code cannot say yet.
- `node e2e/ladder-capture.mjs --only <id>`, then `npm run ladder-score -- --only <id> --record` (plan path, no API key) stores what the model says today.
- Add it to the baseline: `npm run ladder-score -- --offline --update-baseline "<shape>: added, <status today>"`.

### R3. The smallest fix, lowest rung first (in this order)
1. **Data** at the rung that can see it: a kept answer, an alias/meaning in the pack, a recipe, an example in the prompt. 2. **A prompt line about the shape** (not the site) at that rung.
3. **The sketch**: carry what was missing (a candidate, a frame host), found by structure only. 4. **A signal** so a higher rung is asked (flow core: claim it, read its "Invariants:" block, say so to the coordinator).
**A prompt line reaches only its shape:** conditional on the sketch field that shows the shape (e.g. only when frames are listed), with its own fingerprint key, so other fixtures keep their stored answers (an unconditional line cost a 129-fixture re-record, 11 Oct).
Never: a site name, a vendor or word list, a regex over natural language (`tools/hardcoded-page-words.mjs`), a fix in a higher rung for what a lower rung could see.
Flow-core files (`page-kind.js`, `fill-flow.js`, `session-flow.js`, `escalate.js`…) are claimed first (CLAUDE.md "The flow core").

### R4. What to run (say each result)
| Run | Shows |
|---|---|
| `cd desktop && npm run ladder-score` | live on the plan: the fixture now right? rates per source; the wrong-and-confident list did not grow |
| `npm run ladder-score -- --offline` and `node --test test/ladder-ratchet.test.js` | no stored fixture got worse (what the push gate runs) |
| `cd desktop/e2e && npm run recorded` | fixed sites still replay (also with `REAL_EXTENSION_DIR=<old extension/>` it must FAIL: the positive control) |
| `cd desktop/e2e && npm run real-extension` | the extension alone, if `extension/` changed |
| `cd desktop && npm test`, `cd worker && npm test` | the rest |

### R5. Update the baseline honestly
- Better fixtures: `npm run ladder-score -- --offline --update-baseline "<what improved and why>"` (re-record the answers first with `--record` if the prompt changed).
- A fixture that got **worse** is a bug to fix, not a baseline edit. A deliberate trade-off needs the owner's say-so, written in the commit.
- A changed prompt or schema also fails the ratchet ("the prompt of rung N changed") until the answers are re-recorded (`--record`) and `--update-baseline` rewrites the prompt fingerprints.
- The push hook wants two trailers in a commit message of any push that touches flow code: `Rung: <0-6|router|judges>` and `Fixture: <fixture id | none: <why>>` (`tools/rung-trailer.mjs`; the id must exist in `desktop/e2e/ladder-fixtures/`).
- For a shape the pool run saved as a replay candidate: `node desktop/e2e/ladder-capture.mjs --from-candidates --only <shape>` writes a `cand-<shape>` fixture with `expect: pending`; set its real `expect.outcome` first.
- Never edit a fixture's `expect` to make it pass; the ratchet fails on an edited expectation unless the baseline is updated with a reason.

## 4. Land and confirm
- Put `Pool-row: <the row's name as /admin/applying shows it>` in the fix commit's message: it fills the Fixed tab (never an address or a query string; `tools/rung-trailer.mjs` checks it).
- `tools/ship.sh` (never from the twin's worktree: shipping rebases it, and a `ship.sh` without keep-by-default removes it). A push changing how the extension acts on pages needs the recorded page,
  or a scenario (a fill replay alone does not count), or `Recorded-unneeded: <why>` in the commit only when no real site's failure is fixed. Commit subject <= 72 characters.
- **Re-run `npm run smoke -- --only <shape>` on the landed build** (a held run, said before it starts) and compare with the first run: **it must reach further**
  (a later page kind, a fill count > 0). Report: before -> after, counts, what still stops it. Not further = not done: back to step 1 with the new log.
- **Landing does not clear the row** (11 Oct 2026, jobs.ch "Easy apply"): `/admin/applying` lists a site by its LATEST uploaded smoke result, so the row leaves "Needs a fix" only after a run on the landed
  build uploads a better one (a later step, more fields filled, or a documented hold). A recorded page passing is a separate table (Fixed-site replays) and does not clear it; the Fixed tab (`/admin/applying#fixed`) is what shows the row Confirmed. Run it yourself: update your runner to the landed build and `npm run smoke -- --only <shape>` (held, Monitor, upload as the pool does), once the e2e page is free (a peer's run on it: wait or queue). A running
  coordinator may run it for you ("landed <hash>, extension <x.y.z>, run <shape>"), but you never wait on one that is not there. Until the uploaded run is in, say "landed, unconfirmed", never "done". **Never close with "it clears by itself" or "after the next uploaded run"** (11 Oct 2026, Datadog): no nightly schedule exists yet (pool schedule: local only, by hand), so nothing else will run it. Close only when the Fixed tab (`/admin/applying#fixed`) shows the row **Confirmed**; otherwise the closing line says "landed <hash>, unconfirmed: nobody has run it" and names who must (you, or a coordinator you messaged and who answered). Proof: the row's "Filled, last runs" goes up or the row leaves the list.
- **A rung fix** (3b): Commit subject ≤ 72 chars; body: the rung, the shape, the before/after status line from `ladder-score`; `Recorded-unneeded:` only when no real-site failure is fixed. Land with `tools/ship.sh`; tell what other sites this helps and what it does not cover. Trailers `Rung:`/`Fixture:` (hook-checked).
- Report in one line per shape (owner, coordinator if any): shape, fix (mechanism part), reached before -> after, commit, siblings helped. Say "released" for the flow core to every peer.

## Stop conditions
- Whatever the reason you stop, release your claim (`tools/claim-shape.mjs release`), so another session can take the row.
- Reached the form (filled/left counted) or a documented hold (an email code, a captcha, a bot check, a login wall, a 401/403/429): stop, never get past them; note it.
- Two fix rounds without reaching further: stop, write what is known (log lines, frames, what you tried) and hand the shape back; do not keep guessing.
- **A red row is a stated rule, not a bug** (the code refuses it on purpose, e.g. "Easy Apply", a consent, a Submit): do not change the rule yourself. Say what the rule is, what the row would need, and ask the owner;
  a change is a Decision Log entry.
- The shape needs the owner's real state (their account, their Gmail): hand it to the twin skill, never use it here.
- A peer holds the heavy lock (a run) or the flow core: wait or queue yours; never two runs at once. No coordinator running is not a stop: you run it yourself.
- The owner says stop.

## Never
- Submit, a consent, an account button, a captcha or SMS code; the owner's live app, profile, CV, Keychain or paid AI; a fix named after one website.
- A recorded case whose expected result or AI answer was written to fit the fix rather than taken from the live run.
- A long foreground wait: background plus `Monitor`.
- A first run of a new recorded case on the build you are fixing (it uploads a row nobody can delete), a fix built on a guess, or a failure believed on a loaded machine: see lessons.md.
- Fixing a gap in the debugging process (a missing log, a report that hides evidence, a harness that cannot fail) silently: list it and send it to the pool coordinator (`coordinator.txt`) and the flow-core coordinator; the report side (`desktop/e2e/lib/smoke.mjs`) is the pool coordinator's.

## Lessons and self-improve (owner, 11 Oct 2026)
- **Read `lessons.md` (this folder) once at the start:** each lesson has what to do, the incident and whether it is verified or second-hand. Follow it; a lesson that proves wrong is deleted.
- **Self-improve: every time a round teaches something, the skill gets it before you say "done".** A lesson is a surprise, a claim you had to retract, a harness or report gap, a peer's correction, a failure the skill did not warn about.
  1. **Triage:** is it new (grep `lessons.md`)? Is it shown by a log, a count or a failing case (verified), or only reported by another session (second-hand until a run of yours confirms it: say so, spot-check the code)? Is it about a class of problems, not one site? Drop what is a guess, one site's quirk or a duplicate.
  2. **Write it** in `lessons.md` under the right heading: the rule first, then the incident (date, row), then verified or second-hand. Promote it into a SKILL.md step only when it changes what to do first or what never to do.
  3. **Keep SKILL.md under 150 lines:** detail goes to `lessons.md`, steps stay short. Commit the skill on its own (`Skill fix-failing-forms: <lesson>`), and send the process gaps you could not fix yourself to the coordinators.
