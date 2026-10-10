---
name: fix-failing-forms
description: Fix the applying flow's failing or low-reaching shapes one at a time, from the smoke pool's results (/admin/applying and the QA smoke-reports). For each shape, reproduce it in the e2e harness with fake applicant data, say which part of the self-improving mechanism the fix improves, fix it for every site, add a recorded page that fails on the old build, land with tools/ship.sh and re-run to confirm it reached further. Use when the owner says "fix failing forms", "/fix-failing-forms", "fix the pool's worst sites" or names a shape that stops early (e.g. Workday "Start Your Application").
---

# Fix failing forms: one shape at a time, from the pool's numbers

Pattern of `triage-github-open-issues` (a list of failures; one at a time: validate, fix, close, score) applied to the applying flow.
Goal (owner, 9-10 Oct 2026): from the posting to a filled form, stopped before Submit, on any site, and **never fix the same website twice**.
This skill works on the pool (real postings, layer 3 of `docs/superpowers/specs/2026-10-10-applying-reliability-layers.md`). Live sessions on the
owner's twin are `fix-live-applying-in-twin`. The pool's own upkeep (running, growing, coordinating it) is the skill `run-applying-smoke-pool`, which hands failing shapes to this one.

Where the next shape comes from: the platform scorecard on `/admin/applying` names the platforms to fix, in this order: **Weak in both**, **Blind spot** (start with `improve-filling` to see what real fills miss),
**Test failing**. **Not in the pool** is `run-applying-smoke-pool`'s to add first. Rank by "Of matched jobs": the most-used platform that fails comes first (skill `run-applying-smoke-pool` "Reading real use").

## 0. Before starting (one line each to the owner)
- **The list is the page's "Needs a fix" section** (right under the tiles of `/admin/applying`; owner-only; Bearer = Keychain `job-pilotto.site.api_key`, see memory
  `reference-owner-pages-access`; the same rows are in the page's `?json`: pool rows with `regression`, `short`, `shares`, `reached`). It is worst first: regressions, then the earliest
  stop, then the least filled form. A form reached with under half of the asked fields filled is a **shortfall** (red "form · 4 of 12"): a failure, not a success. A code or bot check is a documented
  hold and is not on the list. Take the TOP row, one shape per round. Its evidence is on this Mac: `~/Library/Application Support/Job Pilotto QA/smoke-reports/` (`<day>.json` with each
  site's `fieldList`: label, type, outcome, required, reason per field; one `.log` per run) and **`replay-candidates/<day>/<shape>/`** (the failing run's last page, structure only and scrubbed, with a
  `case.json` skeleton: the run's fields, page path and page-kind lines): start the recorded page from that candidate, take the AI's answers from its `evidence`, never invent them.
  Say: N rows, the top three, the one you take. After the landing, the next night's "Filled, last runs" column of that row is the proof: it must go up or the row must leave the list.
- **Peers:** `ListAgents`; message the pool owner (session in memory `project-handover-smoke-coordinator`) with the shape you take, and ask whether the
  e2e page is free (suites share one Notion test page: never two runs at once). A pool or applying run by a peer: wait, or queue yours.
- **Claim the flow core** (`FLOW_CORE`/`FLOW_FILES`, `desktop/e2e/flows.mjs`) before editing any file in it: one message to every peer "I own the flow core
  until I say released", and "released" when done. Read each file's `Invariants:` block first; changing one is the owner's call, said in the commit.
- **Worktree:** `tools/worktree.sh fix-<shape>`, own scratch folder `<scratchpad>/fix-failing-forms/`. No subagents. Say the change tier (usually Tier 2: apply flow).

## 1. Reproduce (small, isolated, with a positive control)
1. **Read the artifacts before running anything:** the shape's `.log` (page kinds, `fill:` lines, STALL dump with `controls` and `buttons`), its
   `live-frames/*.png` (look at 2-3 frames: what the page really showed), the report's reached step and signature. Name what the log cannot tell and add the log line.
   A frames folder is overwritten by the next run: check that the frame is from YOUR shape's run (host in the log vs the picture).
2. **Run it in the harness, never the twin, never the owner's data:** `cd desktop/e2e && npm run smoke -- --only <shape words>` (the e2e app, its own profile and
   Notion test page, fake applicant, fixture CV, a headless Chrome with the real extension through `lib/extension.mjs`). It is a HELD run: the consent and the
   account button are NOT pressed, never Submit. **Say before it starts** what the window does and what is HELD, and how long (`SMOKE_SECONDS`, default 90).
3. **Watch it with `Monitor`, not sleep** (global rules): background run to a log, then
   `tail -n 0 -F <log> | grep --line-buffered -E "^\s+live \+|STALL|\[extension\] (fill: (page kind|pressed)|can't reach)|^(✓|✗)"`. Test the pattern once with `grep -c`
   on the log so far. Each event: one line on what it shows (progressing / done / stuck). First sign of life within ~20 s or say the experiment failed.
4. **Prove the repro:** the page the run saw is the page you think (frame + `buttons` list), the stub/AI answer you rely on really applied. A shape that only
   fails once (a moody site) is run twice before it counts.

## 2. Say what the fix is, before coding (one block)
- **Which part of the mechanism it improves** (CLAUDE.md "A form bug is fixed in the self-improving mechanism"): an operator, the fingerprint, a meaning in the
  pack, a recipe (data), the page-kind AI's fixed answers, or noticing the miss. Prefer **data** over code; a code fix says why data could not do it.
- **Which of its decisions are AI, structure, floors** (CLAUDE.md "Judgments about a page are the AI's"). A heuristic (word, vendor, regex, "the element vanished")
  becomes an AI field with a fixed answer the code validates.
- **The shape, not the site:** "a start dialog before the form", "a cookie banner over the dialog", not "Workday". List the sibling shapes and sites it also helps
  and what it does not cover. A variant the fix cannot handle is reported with its fingerprint and listed for the person, never skipped silently.

## 3. Fix, with the recorded page first
1. **A recorded page that fails on the old build** (layer 2, `desktop/e2e/recorded/<shape>-<n>/`): capture the real page (`twin:drive capture` only from a twin
   the owner runs; otherwise record the page from the harness run's DOM, scrubbed: no values, no scripts, no query strings, no personal data;
   `desktop/test/recorded-privacy.test.js`). **Its AI answers must be what the real AI answered in the failing run** (from the log / decisions), **and only to what the extension asked** (the `asked` check reads the /extension/answer request's fields; a stub that answers an unasked question lets the old build pass), never an answer
   written by hand to make the case pass (10 Oct 2026: `workday-start-dialog-1` was given `applyButton: "Apply Manually"` by hand, the live AI answered "Apply").
2. Run `cd desktop/e2e && npm run recorded` against the build from before the fix (`REAL_EXTENSION_DIR=<that build's extension/>`): it **must fail**; then on the fix: pass.
   Also a journey scenario in `desktop/test/journeys.test.js` when the logic of the flow changes (failing first).
3. Fix the root cause through the shared mechanism for the whole class; every sibling in the class in the same change. File size <= 500 lines.
4. After a fix to form filling, also `cd desktop/e2e && npm run real-extension` (isolated; positive control with `REAL_EXTENSION_DIR`).
5. New wording the AI sees: update the website's Intelligence page and count (CLAUDE.md), if a user can see a new AI step or rule.

## 4. Land and confirm
- `tools/ship.sh` (never from the twin's worktree: it deletes the worktree it lands). A push changing how the extension acts on pages needs the recorded page,
  or a scenario (a fill replay alone does not count), or `Recorded-unneeded: <why>` in the commit only when no real site's failure is fixed. Commit subject <= 72 characters.
- **Re-run `npm run smoke -- --only <shape>` on the landed build** (a held run, said before it starts) and compare with the first run: **it must reach further**
  (a later page kind, a fill count > 0). Report: before -> after, counts, what still stops it. Not further = not done: back to step 1 with the new log.
- Report to the owner and the pool owner in one line per shape: shape, fix (mechanism part), reached before -> after, commit, sibling sites helped.
- Say "released" for the flow core to every peer.

## Stop conditions
- Reached the form (filled/left counted) or a documented hold (an email code, a captcha, a bot check, a login wall): stop, never get past them.
- Two fix rounds without reaching further: stop, write what is known (log lines, frames, what you tried) and hand the shape back; do not keep guessing.
- A site that blocks automation (401/403/429, a bot check) is a no: note it in the report, leave it.
- The shape needs the owner's real state (their account, their Gmail): hand it to the twin skill, never use it here.
- The pool owner or a peer holds the e2e page or the flow core: wait or hand over; never two runs on one page.
- The owner says stop.

## Never
- Submit, a consent, an account button, a captcha or SMS code; the owner's live app, profile, CV, Keychain or paid AI; a fix named after one website.
- A recorded case whose expected result or AI answer was written to fit the fix rather than taken from the live run.
- A long foreground wait: background plus `Monitor`.
