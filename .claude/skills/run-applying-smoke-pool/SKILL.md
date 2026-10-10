---
name: run-applying-smoke-pool
description: Run, grow and coordinate the pool of real sites the applying flow is tested on (layer 3 of the applying reliability spec): the nightly smoke, discovery of new flow shapes, the report on /admin/applying, the e2e page that sessions share, and the hand-off of failing shapes to fix-failing-forms. Use when the owner says "run the smoke pool", "/run-applying-smoke-pool", "grow the pool", "run discovery", or when taking over the applying test pool from another session.
---

# Run the applying smoke pool

The pool is ~50 real postings, one per **flow shape**, run live and HELD (never an account button, never Submit) with the real extension in the
e2e harness. It answers "did a real site change under us, and how far does each flow get?". This skill **runs, grows and coordinates** it. It does
not fix shapes: a failing one goes to `/fix-failing-forms`; one that needs the owner's real state goes to `/fix-live-applying-in-twin`.
Spec: `docs/superpowers/specs/2026-10-10-applying-reliability-layers.md` (four layers); flows map: `docs/flows/applying.md`.

## What exists
- **Runner** `desktop/e2e/smoke.mjs` (`cd desktop/e2e && npm run smoke`), logic in `lib/smoke.mjs` (rotation `tonight`, `parseLive`, `signature`, `compare`,
  `NEVER_VISIT`), upload in `lib/applying-report.mjs`. It never schedules itself: the nightly schedule (launchd vs by hand) is the owner's choice, ask once.
- **The pool, two lists, merged:** public `desktop/e2e/smoke-sites.json` (postings from PUBLIC job feeds only) and this Mac's
  `~/Library/Application Support/Job Pilotto QA/smoke-sites.json` (postings copied from the owner's profiles; outside the repo AND outside the app folder, because a
  profile reset wiped the app folder once). **Never commit a posting taken from a profile to the public repo** (stopped once before a push).
- **Reports:** `~/Library/Application Support/Job Pilotto QA/smoke-reports/<day>.json` + one `.log` per run + `discover-<day>.json`. They name real postings: they stay on the Mac.
- **/admin/applying** (owner-only QA page, not `/admin/form-filling`, which is real users): tiles, fixed-site replays, "The pool" table (platform from the END host,
  flow words), nights. Bearer = Keychain `job-pilotto.site.api_key` (memory `reference-owner-pages-access`). Uploads carry hosts, site names and signatures only,
  never a posting address (`applying-report.mjs`; a test fails on a path, query or token); never uploaded from CI or control runs (`REAL_EXTENSION_DIR`).
- **Other layers** it sits beside: journey scenarios (`desktop/test/journeys.test.js`), recorded pages (`desktop/e2e/recorded/`, `npm run recorded`), the fleet digest (`boards[].dropped`).

## Commands (all from `desktop/e2e`, in your own worktree: `tools/worktree.sh smoke-<topic>`)
| What | Command |
|---|---|
| Tonight's share (`SMOKE_PER_NIGHT`, default 10, window moving each day) | `npm run smoke` |
| Some shapes | `npm run smoke -- --only <words of the shape>` |
| The whole pool (~55 x 2 min) | `npm run smoke -- --all` |
| Find new flow shapes from the loaded profile's jobs (a few per host, more from boards) | `npm run smoke -- --discover --limit 30` (~45 min) |

`--discover` names a new shape by the posting's employer and, when the same host has a shape that was never run, fills that one instead of adding a row (474c641).
Longer waits: `SMOKE_SECONDS` (default 90). A posting gone (HTTP 404/410) is noted and replaced, never a regression. Exit 1 = a shape reached less than ITS last run.

## The rules that bite
- **One run on the e2e page at a time** (the suites share one Notion test page and ports). Before any run: `ListAgents`, and ask the peers "is the e2e page free?"; say what you run and for
  how long; send "done" when finished. A peer holding it: wait, or queue. Never start a second run on it.
- **Say before a held run** what the window does and what is HELD (headless Chrome, fake applicant, no consent, no account button, never Submit), and how long.
- **Background + Monitor, never sleep** (global rules). Start the run writing to a log, then arm a Monitor on its summary lines:
  `tail -n 0 -F <log> | grep --line-buffered -E "^smoke: |regression|rror:"` (one event per site: `reached <step>`, filled/left counts), and a second one for the end: save the run's PID at start (`echo $! > <scratch>/pid`) and watch `while kill -0 $PID 2>/dev/null; do sleep 3; done; echo ended`.
  Never `pgrep -f smoke.mjs` inside a Monitor: the Monitor's own command line contains the pattern and matches itself, so it never ends (anchor it, `pgrep -f "^node smoke.mjs"`, if you must). Test the pattern with `grep -c` on a log so far. Each event: one line on what it shows, then decide (progressing / done / stuck).
  First sign of life within ~20 s or say the run failed. Stop only your own run, by saved PID, never `pkill -f` (it kills other sessions' suites).
- **NEVER_VISIT:** LinkedIn, Glassdoor, Indeed, levels.fyi, Reddit are never run (`lib/smoke.mjs` `NEVER_VISIT`; discovery once visited an Indeed posting before it existed).
  Check any new candidate source against it. Never log in, never get past a login wall or bot check (401/403/429 or a check is a "bot/code" result, not a bug to defeat).
- **Isolation:** the harness cuts off the live app, profile, CV, Keychain and paid AI and asserts it (`lib/extension.mjs`, `startRealExtension`). After a run, check the live app's
  `logs/app.log` has no lines from it. Never hand-roll a launcher.
- **Distinct flows, not distinct addresses:** a candidate joins the pool only with a flow signature the pool lacks (page kinds in order, the host the journey ended on, how far it got).
  Platform is decided from structure (the end host), flows from the extension's own page-kind decisions, never from addresses or words.
- **No local flows matrix as a gate** (owner, 9 Oct): the pool and the matrix never block a push; live sites are moody.

## A round
1. **Free page?** Peers asked, page claimed. Tell them what and for how long.
2. **Run** (tonight's share, or `--only`/`--all`, or `--discover` when the owner loaded a new profile), held, with Monitor. Report per site as it lands.
3. **Read the result:** regressions first (a shape that reached less than its last run), then the sites that reached the earliest step, then bot/code holds (documented, left alone).
   Compare with the last report; a site that failed once is run again before it counts.
4. **Hand off** each failing shape, one line each, to `/fix-failing-forms` (the shape, the log path, the frame folder, what the log cannot tell). Several sessions may each take a different shape:
   give every one its own worktree and scratch folder (global rule "Several agents at once"), and the flow core goes to one session at a time (claim message).
   A shape that needs the owner's accounts or Gmail goes to `/fix-live-applying-in-twin`.
5. **Grow the pool** (when asked or after a profile change): `--discover`; read what it added to the Mac's list and why (the new signature). Never add a posting address to the public file unless it is from a public feed.
6. **Report to the owner:** counts (run, reached form / posting / bot, regressions, new shapes), what moved since the last report, what was handed to whom. Say "done" to the peers.

## Open threads to carry (10 Oct 2026; drop each when closed)
- Discovery is serial (~90 s a candidate, ~45 min per 30) because every run shares one e2e app and Notion test page. A `--workers` option (own port and profile per worker) is not built; the owner asked about it, the pool owner will brief it.
- Ask the owner: the nightly schedule (launchd or by hand); a `prestart` that prints npm's error on failure; renaming the Jobs "Closed" counter; multi-step AI answers for account recorded cases.
- Chanel's Workday dialog has a fourth option, "Autofill with Resume", with no route in the page-kind answers (`desktop/lib/page-kind.js` `ROUTES`); the run still reached the form. Decide with the owner whether it needs a route.

## Traps found while building the pool (each cost time)
- `ship.sh` deletes the worktree it lands: never run the twin or a long run from a worktree you ship from.
- The guard hook misreads `>`, `=` and `$VAR` paths in commands run from the primary checkout: run from a worktree, with literal paths.
- A negative-only recorded case must watch its whole window; count tabs OPENED, not left. A "gone: <selector>" check on an element that starts hidden is true before anything happens: assert an outcome (a field filled).
- The live harness's stall dump is capped (12 buttons): a missing button in it is not evidence; look at the frames, and check the frames folder belongs to YOUR run (the next site overwrites it).
- Codemap: commit first, then `node desktop/scripts/codemap.mjs`, then amend (the reverse turned main red once; `tools/ship.sh --fix` for a red main).
- A removed worktree's results are dropped by the Stop hook (fixed); a name that already exists in `desktop/e2e` (`lib/replay.mjs`) was overwritten once: grep before naming a file.

- The `/admin/applying` pool count changes only when a run ENDS (`sendPool` at the end of smoke or discover); the Mac's own list changes at once. A half-finished run shows nothing there.
- Never `git checkout` in the primary checkout: other sessions and uncommitted changes live there. Work in your own worktree.

## Stop conditions
- The e2e page is held by a peer, or a peer asks for it back: stop your own run by PID and say so.
- A run shows the isolation assertion failing, or lines in the live app's log: stop everything, say what was reached, fix the isolation first.
- Two rounds in a row with the same shape failing for the same reason: stop re-running, write what is known and hand it to `/fix-failing-forms`; do not loop the pool to see it again.
- The owner says stop.
