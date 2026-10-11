# The change loop: habits, big changes, e2e steps, debugging

Linked from CLAUDE.md. The tiers and "which test for which question" are in [AGENTS.md](../../AGENTS.md#change-tiers-pick-one-say-it-in-one-line-stop-when-it-is-met-6-oct-2026).
Why each rule exists: [why.md](why.md#change-loop).

## The habits that prevented rework
1. A bug the owner saw: find the root cause and write a failing test before any fix.
2. Tests first for new behaviour; watch the test fail for the right reason.
3. UI from an owner mockup or request: confirm layout + behaviour in one message before code.
4. "Done" = tests pass as CI runs them (`JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs python3 -m unittest discover -s tests`, desktop
   `npm ci` with dev deps); say what you verified and what you didn't.
5. **A feature or behaviour change updates the e2e step it breaks, in the same commit.** Before you push: `grep` the visible words, selectors and
   commands you changed in `desktop/e2e/` (`suites/`, `lib/`) and the unit tests; fix what you find, or say in the commit body which step is now
   stale. A new detector or plant needs its unit test page to carry what it checks (`test/recall.test.mjs`).
6. **A new e2e step is seen passing before it lands, and proves its own setup.** The push hook (`tools/new-e2e-steps.mjs`) wants a local run that
   passed it, or `E2E-unverified: <why>`. In the step, assert the setup took effect (the stub was called, the seed is in the state).
7. **Never start a CI e2e run by hand; run the suites locally** (owner, 9 Oct 2026: local runs use the plan; CI spends the test keys). No
   `gh workflow run e2e.yml`, no `e2e-try/*` tag, unless the owner asks. `cd desktop/e2e && E2E_STEPS=... node run-all.mjs --only <suite>`;
   `E2E_AI_FAMILY=openai` runs the OpenAI side on Codex.

## A big change: slices, a safety net first, ONE full run at landing (owner, 10 Oct 2026)
1. **Size it first** (Tier 0/1/2). Above Tier 1: a spec with a checklist (`docs/superpowers/specs/`, a `## Progress` section; skill
   `report-progress`), and say what stays unverified.
2. **Safety net before behaviour:** fixtures, a baseline and a gate (`ladder-score`, `tools/ladder-gate.mjs`, recorded pages, contract and
   architecture tests) exist BEFORE the change.
3. **Three speeds:** each edit runs only the touched test (seconds); each finished slice runs the gate and the replays it touches (1-2 min); the
   FULL suites, all replays, real-extension and the old-build controls run ONCE per landing, in the background (`run_in_background` + Monitor).
   Extension version, fingerprint and codemap are written once, at landing (a second write at the same version is refused:
   `git checkout origin/main -- extension/fingerprint.json`, then write).
4. **Commits:** small local commits are free; what lands is 1-3 squashed commits by concern.
5. **Parallel sessions by file ownership, not by task:** one session owns the flow core; others get new files, tests, the site, measurement
   (brief + own worktree + commit only + report; the coordinator lands). Fix the landing order and any freeze window up front; message every peer.
6. **A migration or move is its own pure commit** ([files.md](files.md#splitting-a-file-safely)).
7. **Measure per source** (real / reconstructed / invented), never blended, never tune on invented data.

## Debugging a failing e2e step
- **Read before you re-run.** `desktop/e2e/artifacts/<suite>/suite-failures.json`, `artifacts/<suite>.run.log`, the screenshot, `logs/app.log`.
  A worktree's `artifacts/` goes with it: copy what you still need first. A failure that says only `""` or "not found" is missing evidence: add the
  capture or log line that would have answered it.
- **Reproduce small, in seconds, then confirm once.** Seed the state: `npm run shot -- <page> --js "<click>" --eval "<state>"` on `desktop/demo/`
  fixtures (Notion pages in demo mode come from `demo/run-pages.json`), or a unit test. Then the step once:
  `E2E_STEPS="<step>,<prerequisites>" node run-all.mjs --only <suite>` (setup steps marked critical always run). Full suite only as the last check.
- **Prove the repro** before saying "reproduced" or "never called": its own setup took effect. `window.pilot` is a read-only contextBridge:
  assigning to it does nothing. A step run alone lacks what skipped steps built: list what you removed.
- **Other sessions share the suite's Notion token.** Check `logs/notion-requests.log` for 429s and runs you did not start; the app's Notion calls
  queue (~340 ms apart, 25 s+ after a start).
- **Nothing is swallowed silently.** A `.catch(() => …)` logs what it caught. A failing step saves the app's state before it closes anything.
