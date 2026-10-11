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
- Touching the decision core (`FLOW_CORE`): its steps run with every other e2e on CI (`apply`, `applycv`); the browser matrix is no push gate.
  `cd desktop && npm run flows` (~5 min) is an on-demand check for a big flow change.
- One step locally: `E2E_STEPS='the app has an applicant,<journey>,<step>' node suite.mjs applyflows`.
- A new scenario gets a row in `docs/flows/applying.md` and in `MATRIX`, with a step or test that fails first.
- **One owner per state:** where an application stands is `desktop/lib/application-journey.js` (app) and `extension/tab-identity.js` (which
  application a tab is); never a new field or storage key for it elsewhere. Spec: `docs/superpowers/specs/2026-10-10-application-journey.md`.

## The flow core: one session at a time, invariants first (owner, 10 Oct 2026)
- **Claim it before editing** `FLOW_CORE` / `FLOW_FILES`: one message to every peer ("I own the flow core until I say released"), and "released"
  when done. A peer holding it: wait, or send your change to them. No new applying feature while a journey refactor is landing.
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
3. The live smoke pool (run by hand only, owner 11 Oct 2026).
4. Per-board drops in the digest (`/admin/form-filling/digest.json`, `boards[].dropped`).
- **A push changing how the extension acts on pages must add a recorded page or a scenario** (`tools/recorded-cases.mjs`, push hook).
  `Recorded-unneeded: <why>` only for a change that fixes no failure seen on a real site. A field replay (`worker/test/fixtures/fill/`) is a second
  layer, never the proof.
- **The Fixed tab** on `/admin/applying` (`#fixed`) holds each fix's status and guard. Optional commit trailer `Pool-row: <the pool row's name as
  /admin/applying shows it>` fills it (`tools/rung-trailer.mjs` checks it; no address or query string). Close a fix only when the Fixed tab shows
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
- **A held run says so** (`HELD by the live test` in the log, the banner and the stall report; `LIVE_SUBMIT=1` lets the consent and the account
  button through). Before starting one, tell the owner what the window will and will not do; watch it with Monitor (global rules).
- Report what it showed: what worked, what did not, what the log cannot tell (then add the log line).
