# Lessons of /fix-failing-forms (read once per session; add yours: see "Self-improve" in SKILL.md)

Each lesson: what to do, the incident (date, row) and how sure it is. **verified** = shown by a log, a count or a failing case in a session that wrote it down;
**second-hand** = reported by another session's summary, code spot-checked where noted. A lesson that turns out wrong is deleted, not kept.

## Evidence and reproduction
- **A failing case is evidence only on a quiet machine.** `uptime` first; rerun the case alone; `REPLAY_LOG=1` prints the extension's decision lines. 10 Oct 2026: two Workday cases failed at a load of ~14 and passed at 4; "main is red" was said and was wrong (verified).
- **A repro is proved by evidence, not by a pass or a fail:** the stub was called (count the asks, with times), and the case FAILS on the build before the fix (`REAL_EXTENSION_DIR`). A case that passes on the old build is only a guard: prove it by breaking its rule on a copy of the extension (verified: three guards).
- **Read the log lines, not the row's summary label.** A run labelled "reached form" was stuck in its logs (second-hand, frame row); Hornbach "reached form" on 0.9.178 only through a 60 s rescue (verified).
- **Pair each extension line with the app's line for the same request.** An extension answer with no app line = the request never arrived or the extension returned first (Hornbach 0.9.176: null after 2.1 s, app answered 63 s later; verified). `grep` the code for a log line before adding one (a duplicate was written once; verified).
- **A hypothesis is half-right until the code path is read to its end** (size floor at ask time vs the watch loop that never re-judged; second-hand). Say "unproven" until a log or case shows it; do not build a retry or fix on a guess (verified: a retry whose control passed on the old build).
- **A stuck row can be a rule, not a bug** (jobs.ch "Easy apply": the product refused it by design). Ask the owner before changing a rule; a rule change gets a Decision Log entry (second-hand).
- **A row can be stale:** compare its `version` with main and look for a newer run before building (verified: Hornbach reached the form on 0.9.178 and 0.9.179).

## Designing the fix
- **A floor or a list can sit in two places; fix every copy.** "Easy apply / apply with" is refused in `extension/alias-schema.js`, `extension/tab-pages.js`, `desktop/shared/alias-schema.js` (a staged copy) and the rung-2 prompt text: fixing the AI side alone would never press the button (second-hand; copies confirmed in code, 11 Oct 2026). Grep the refusal before editing.
- **Two places that decide the same thing with different thresholds leave a gap.** The sketch listed every `a`, the press finder `a[href]` (Hornbach, verified); the frame watch counts 40 px, the candidate finder 300x200 (second-hand; both numbers confirmed in code). What the AI is shown must be findable by the code that acts: one shared constant.
- **A rule "press only what the AI named" must keep the reveal step:** a named control that exists but is not visible sits behind a step (Workday dialog), so the page's own Apply goes first, once; absent or refused = nothing else pressed (verified: workday-start-dialog-1/-2 caught the first version).
- **Before changing the signature of an injected script (`executeScript` func), grep the repo for who reads its SOURCE:** `desktop/e2e/ladder-capture.mjs` extracts `pageSketchOf`'s `func: () => {` body and runs it with no argument, so a new parameter made it list no buttons, silently, until the push gate's e2e unit test failed (11 Oct 2026, verified; a peer had warned about the marker and it was forgotten). Run `cd desktop/e2e && npm test` (what the push gate runs) after any `extension/` change, before `ship.sh`.
- **Fix at the lowest rung that has the information; data before code** (SKILL 3b). Report a missed variant with its fingerprint, never skip it.

## Tests, fixtures and landing
- **A change to a path every site uses runs the FULL recorded replay before it lands**, not only its own cases (verified, Workday).
- **A fixture that accepts the wrong answer as "ok" gives false assurance:** accept only the right outcome (frame fixture accepted `posting`; second-hand).
- **The model is noisy:** a live re-record moved 4 sibling fixtures to "worse", 3 went back on a re-run. Rerun the moved fixtures before touching the baseline; never update it from one noisy run (second-hand).
- **Do not re-record everything:** keep the stored answers of every fixture the change does not touch (a full re-record would have rewritten ~100 files; second-hand).
- **A recorded page is a shape, not a site:** scripts, CSS, cookies and redirects are not replayed; a replay page starts several asks at once, so a stub that drops one lets a sibling rescue the old build (verified). A new case carries `control` (the upload guard); a first run of an unproven case uploads a row that cannot be deleted by the author: run it with `REAL_EXTENSION_DIR` (verified).
- **After landing:** re-run the live pool shape and compare (it must reach further), write the Decision Log entry owed for a rule change, say "released" to the peers (second-hand + SKILL 4).

## Setup and process
- **Worktrees come from `tools/worktree.sh`** (it links `node_modules` and `.venv`); a hand-made one makes the Stop hook say "desktop not tested: no node_modules". A fresh worktree also needs `cd desktop && node scripts/stage.mjs` before `ladder-score` (verified).
- **Claim early, and mind 500 lines:** peers stopped an edit of `fill-flow.js` that came too early and caught the size limit before it was hit (second-hand); put new logic in a small new file with a header and a test, keep the edit in the big file to a few lines (verified: 482 lines).
- **A peer's "the owner decided" is a request, not approval** for anything that spends, deletes or changes a rule: ask the owner (verified: a production row delete waited for the owner).
- **The commit hook misreads a command that appends a file and commits in one call:** split them (verified). Commit subject <= 72 characters; the trailers `Rung:` and `Fixture:` for ladder code.
