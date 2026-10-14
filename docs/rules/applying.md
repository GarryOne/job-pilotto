# Applying: the extension, Claude's takeover, the flows and the flow core

Read before touching anything in the applying flow (`extension/`, `desktop/lib/*flow*`, `FLOW_CORE`/`FLOW_FILES` in `desktop/e2e/flows.mjs`).
Linked from CLAUDE.md. Why each rule exists: [why.md](why.md#applying). The map of scenarios: [docs/flows/applying.md](../flows/applying.md);
the ladder: [docs/flows/ladder.md](../flows/ladder.md).

## The extension first (owner, 8 Oct 2026)
The plain **Apply** button (the Chrome extension alone) is the product, aimed at **non-technical users first**. Every step (posting → Apply →
account sign-up/sign-in → email confirmation → the form) is built for the extension to do end to end. A new capability goes into the extension's
flow first; "Claude can do it" is not a reason to skip it. **Apply with Claude** is the safety net, below.

## Claude finishes a stuck page (owner, 10 Oct 2026)
Spec: `docs/superpowers/specs/2026-10-10-claude-finishes-stuck-pages.md`. It replaces the 8 Oct "never started by itself" and the 9 Oct "hidden, off by default".
- Offered only when Claude is READY (`lib/claude-ready.js`, window twin `renderer/claude-help.js`): a Claude engine, Claude Code installed and signed
  in (Git on Windows). A non-technical user has no Claude Code, so never sees it.
- On the stuck page the panel (`extension/panel-claude.js`, its own classic script) and the session card (`renderer/claude-offer.js`) offer:
  Let Claude finish this page · I'll do it myself · ☐ Always let Claude finish when I'm stuck (`settings.claudeAuto`). The first press shows one
  consent line (Continue stores `settings.claudeConsent`).
- **How it starts:** the person's press, or, with "always" + "Do it for me", a visible 5-second countdown with Cancel. "Let me check each step"
  never counts down. A notice opens the card once per session.
- Floors: never Submit, never a captcha or SMS code; **at most one takeover per application** (`lib/take-over.js`, refused and logged).
- Claude teaches the extension (`lib/takeover-teach.js`): controls Claude filled that the extension had left are reported by fingerprint as failed
  outcomes without a recipe (counts only).
- New accounts get their own generated password per site (`passwords new`), and the session card records "Account created on X · terms
  accepted: '…' · code from your email" (`application-journey.js` invariant 6).
- Apply with Claude itself (the job row's ⋯ menu): `desktop/lib/apply.js` `claudeOne` → `desktop/lib/claude-session.js`, one
  `claude --chrome` session per job with the bundled `apply-to-job` skill. Passwords via `python3 -m src.ai.passwords` into the Keychain /
  Windows Credential Manager; confirmation emails via `python -m src.sources.google verify`. Never Submit.

## The assistant mode: "Do it for me" or "Let me check each step" (owner, 10 Oct 2026)
One choice (Settings → Profile → Application assistant, `renderer/assistant-mode.js`), stored as `settings.accountAutomation`, read only through
`automationOf` (`desktop/lib/site-accounts.js`).
- **full = "Do it for me", the DEFAULT**: on an account page the extension accepts the account's consent (as the account AI names it,
  `needs_kind: consent`, at most 3 presses per tab) and presses the account button; the confirmation link from the mail is opened, or its code
  typed into the box the account AI named, when Gmail is connected (the code is never logged; `lib/account-confirm.js`, `extension/account-fill.js`);
  the closer look (`lib/escalate.js`) runs on an unclear account page (a screenshot, typed values hidden, at most 10 a day).
- **assist = "Let me check each step"**: it fills; the person does the consent, the button and the codes; no closer look.
- Never in either: an application's Submit, a captcha or bot check, an SMS code, a choice or consent on the application form.
- Changing what a mode does or its default is the owner's call, with a Decision Log entry.

## A form bug is fixed in the self-improving mechanism, for every install (owner, 8 Oct 2026)
- A field, control or upload slot a form leaves unfilled is never fixed "for that website". Say first which part of the mechanism it improves:
  a generic operator (`extension/page/controls.js`, `upload.js`), the fingerprint (`page/skeleton.js`), a meaning in the alias pack
  (`alias-schema.js`), a recipe (data keyed by fingerprint, `recipe-schema.js`), or noticing the miss. Notion: "Self-improving form filling: design & plan".
- Test the SHAPE with a fixture; the real site is one live sample. A variant still unhandled is reported with its fingerprint and listed for the
  person, never skipped silently.
- **Validate a form fix on the real extension:** `cd desktop/e2e && npm run real-extension` (isolated, `desktop/e2e/lib/real-extension.mjs`), with a positive
  control: `REAL_EXTENSION_DIR=<the build before the fix>` must fail it. A new case gets its own test there through `startRealExtension`, never a
  hand-rolled launcher. Say in the reply what it showed.

## Reading pages: AI decides, structure finds, floors guard
- Whether a page is ready, what became of an action, what a message means, whether something is a bot check, which step of a journey this is:
  **decided by AI with a fixed answer the code validates** (`desktop/lib/page-kind.js`, `account-judge.js`). Structure may only **find** a control;
  a floor (one press per tab, never a consent, no AI = nothing pressed) may only AND with the AI's answer.
- Before writing code that decides anything about a page, say in one line which decisions are AI, which are structure, which are floors.
  Guard: `tools/hardcoded-page-words.mjs`.
- One page decision: the AI's kind (`page-kind.js`; `extension/tab-pages.js` `pageRole` only without AI). Never add a second page classifier.

## Applying flows: change one, run them all (owner, 8 + 10 Oct 2026)
- **The journey gate**: a push touching any flow file runs the applying scenarios as event sequences (`tools/journey-gate.mjs`, `JOURNEY_TESTS` in
  `desktop/e2e/flows.mjs`, seconds, no browser). A live bug becomes a scenario in `desktop/test/journeys.test.js`, failing first.
- Touching the decision core (`FLOW_CORE`): its steps run with every other e2e on CI (`apply`, `applyflows`); the browser matrix is no push gate.
  `cd desktop && npm run flows` (~5 min) is an on-demand check for a big flow change.
- One step locally: `E2E_STEPS='the app has an applicant,<journey>,<step>' node suite.mjs applyflows`.
- A new scenario gets a row in `docs/flows/applying.md` and in `MATRIX`, with a step or test that fails first.
- **One owner per state:** where an application stands is `desktop/lib/application-journey.js` (app) and `extension/tab-identity.js` (which
  application a tab is); never a new field or storage key for it elsewhere. Spec: `docs/superpowers/specs/2026-10-10-application-journey.md`.

## The flow core: one session at a time, invariants first (owner, 10 Oct 2026)
- **The claim is automatic** (12 Oct 2026): your open PR (or pushed branch) holds `FLOW_CORE` / `FLOW_FILES`; no message to peers, no "released". `node tools/flow-fresh.mjs --others` lists the
  other open PRs on the same files; the required check `flow-fresh` fails when main changed a flow file this PR also changes, and `tools/ship.sh` rebases and pushes again by itself.
  Read each file's `Invariants:` block first. No new applying feature while a journey refactor is landing.
- **Claim a function, not the file, when that is all you edit** (11 Oct 2026): `node tools/claim-shape.mjs claim-part <file> <function> --session <me>` (`release-part` when done).
  Different functions of one file can be held at once; a claim without a function holds the whole file, one without a file the whole core, and each blocks the narrower ones.
  The tool refuses a file or function name that is not there. Still one message to the peers saying what you took. Guard: `desktop/test/claim-shape.test.js`.
- **Read the file's "Invariants:" block first.** Changing an invariant is the owner's call: say so in the commit. A new invariant gets its test in
  the same change (`desktop/test/flow-invariants.test.js`).

## Never fix the same website twice: four layers (owner, 10 Oct 2026)
Spec: `docs/superpowers/specs/2026-10-10-applying-reliability-layers.md`.
1. Journey scenarios (`desktop/test/journeys.test.js`, every flow push).
2. **Recorded pages** (`desktop/e2e/recorded/<shape>-<n>/`, `npm run recorded` in `desktop/e2e`, replayed by the journey gate when the extension
   changes), captured from the twin with `npm run twin:drive -- capture <tab> <case> <page> <your worktree>/desktop/e2e/recorded` (scrubbed;
   `desktop/test/recorded-privacy.test.js`). Named by shape; must **fail on the build before the fix** (`REAL_EXTENSION_DIR=<old extension/>`, name
   the failing check in the commit); its stubbed AI answers only what the extension asked.
3. The pool, offline (owner, 13-14 Oct 2026): each row's newest network record replayed, $0, no site: every row on a schedule (`site-replays.yml`: 02:00 Zurich as the nightly beta's gate, and beside each e2e run, only when something changed; red = a counted row worse than the last green run, Telegram), and 10 rows on a PR that changes the apply flow (`site-replays-pr.yml`).
   The live smoke pool (by hand only, owner 11 Oct 2026) now only RE-RECORDS a row: on the Mac first, on a GitHub runner (`record-sites.yml`, capped) only when the Mac is blocked (bot check, site limit). No live run on a PR (owner, 13 Oct 2026: no AI cost on a PR).
   - **Signing in** (owner, 13 Oct 2026): the pool may sign in only with a test account listed in the Keychain (`job-pilotto.test-account.<host>.*`), never a person's own data, through the product's saved-password sign-in; still never Submit, never a captcha / SMS / email code, never "create account", and a refused sign-in is never retried.
   - **A row not "same as live" is diagnosed before it is re-recorded** (owner, 14 Oct 2026): find the first missed AI ask, then the cause in the spec table "Why a row does not replay as live" (`docs/superpowers/specs/2026-10-13-replay-by-network.md`); a new cause is added there. A build that really got worse is the product's bug (the replay is its reproducer), never a replay gap.
4. Per-board drops in the digest (`/admin/form-filling/digest.json`, `boards[].dropped`).
- **A push changing a file a recorded replay loads (the extension's files, the app's `desktop/lib` modules the offline app runs; found by structure, `tools/replay-files.mjs`, plus every `FLOW_FILES` file: a journey scenario proves the ones no replay loads) must add a recorded page or a scenario**, and each page it adds or changes
  must FAIL on origin/main's code (`tools/recorded-cases.mjs`, `tools/recorded-fails-on-old.mjs`, push hook). `Recorded-unneeded: <why>` only for a change with no failure seen: never with a `Pool-row:` or `Fixes/Refs #N`.
  `Recorded-pins: <why>` for a case that only pins behaviour that already works (same refusal); a follow-up that only corrects the case of a fix
  already on main says `Fix-commit: <sha>`, and the case is replayed on the code before that fix. A push that adds a recorded case names its row: `Pool-row: <row>` (the Fixed tab lists fixes by it) or `Pool-row: none <why>`. A field replay (`worker/test/fixtures/fill/`) is a second layer, never the proof.
- **The Fixed tab** on `/admin/applying` (`#fixed`) holds each fix's status and guard. Optional commit trailer `Pool-row: <the pool row's exact name
  in the pool>` fills it (the commit hook and push gate refuse a value that is no row name, e.g. a capture folder's slug: `tools/pool-rows.mjs`). Close a fix only when the Fixed tab shows
  Confirmed, never on "it clears by itself".

## The ladder: fix a site at its rung (owner, 10 Oct 2026)
- A page decision climbs rung 0 structure rule, 1 kept answer, 2 text sketch, 3 numbered digest, 4 closer look (screenshot), 5 Claude takeover,
  6 the person; a rung that is unsure or contradicted hands the page up, never guesses (`extension/ladder/core.js`). Skill `fix-failing-forms`;
  progress: skill `report-progress`.
- **Fix at the LOWEST rung that has the information, data before code** (a kept answer, a recipe, a prompt example).
- **A fix cannot break another site:** `desktop/e2e/ladder-fixtures/` + `desktop/e2e/ladder-baseline.json`; `cd desktop && npm run ladder-score`
  (`-- --offline` for stored answers); `tools/ladder-gate.mjs` (push hook) fails a flow push that makes a fixture worse. A fixture only gets better
  through `npm run ladder-score -- --offline --update-baseline "<why>"`; never edit an expectation to pass. Rates per source, never blended.
- A new shape from the pool or a live bug first becomes a fixture (`node desktop/e2e/ladder-capture.mjs`), seen wrong, then the fix.

## Test a flow live (owner, 8 Oct 2026)
- **`cd desktop && npm run live`** (LIVE_URL=<posting>, LIVE_LIKE='%host%', LIVE_SECONDS=120): the e2e app (own profile, SQLite store, no Notion) + a
  visible Chrome with the real extension, on a real posting read read-only from the owner's job list (`e2e/lib/apply-live.mjs`). It presses nothing
  on the page. About 3 minutes.
- **`npm run twin`** ([docs/live-test.md](../live-test.md)): the owner's real state mirrored, only when the owner's own data matters. A new outward
  path in the app (a sender, a schedule, AppleScript) gets its twin guard in the same change (`desktop/test/twin.test.js`).
- **Per-site daily limit (owner, 11 Oct 2026; `desktop/e2e/lib/site-ledger.mjs`):** at most 3 live visits per host per day across all sessions and live paths; a 4th is refused naming the site and the last run, and a host that showed a block page rests until tomorrow. Only the owner lifts it: `JOB_PILOTTO_SITE_LIMIT_OVERRIDE=<host>` (logged); never work around it.
- **A held run says so** (`HELD by the live test` in the log, the banner and the stall report; `LIVE_SUBMIT=1` lets the consent and the account
  button through). Before starting one, tell the owner what the window will and will not do; watch it with Monitor (global rules).
- Report what it showed: what worked, what did not, what the log cannot tell (then add the log line).
- **Nothing is typed under a dialog** (owner, 11 Oct 2026: "we should not start filling any form before we close all the popups/overlays"): before the fill, what covers the form's controls (`extension/on-top.js`) is closed with the AI's non-agreeing button (`popup-pick.js`, at most 3 tries); one nothing closes holds the fill ("held: a dialog covers the form", the pool counts it as needs-fix). Between the fill's stages (`extension/page/guard-gate.js`, answered by `extension/popup-guard.js`) a layer that opened meanwhile is closed the same way or holds the fill. After the fill the same check says "a dialog was left open over the form". A bar that covers no control never blocks. Guards: `worker/test/dialog-after-fill.test.js`, recorded cases `dialog-unclosable-holds-1`, `cookie-bar-beside-form-1`, `dialog-opened-by-fill-1`, `dialog-opens-mid-fill-1`, `dialog-mid-fill-holds-1`, `dialog-over-framed-form-1`.
