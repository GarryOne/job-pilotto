# Job Pilotto — notes for Claude

Personal job-search automation: crawls job boards and employer feeds, filters and scores jobs with Claude, sends a Telegram digest, tracks applications in Notion.

## Start here
1. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**, once, at the start of a session: how a job moves and
   where the code sits. **[docs/HOW-IT-RUNS.md](docs/HOW-IT-RUNS.md)** only when the task touches an
   automatic loop: trigger, what it may change, where the owner approves.
2. Read the Notion page **Session Handoff — Start Here (for Claude)** (`3e562be8fd8681af9a4dd8732964fd94`) via the Notion MCP. It has the owner's preferences, current state, open threads and known gotchas.
3. Then **Technical Reference — Implementation** (`3e562be8fd868124a28ee7c044dc83dc`), the latest **Run Log** entries and the **Decision Log**.
4. For any other Notion page/database ID, or to find where something lives, use the skill **notion-map** (private: `GarryOne/job-pilotto-internal`, linked on the owner's Mac as `~/.claude/skills/notion-map`) instead of searching from scratch.
5. **Code: `grep -i <keyword> CODEMAP.md`** (every file → its purpose, generated, kept fresh by a test; ~12k tokens, so never read it
   whole), then open only the file you need. Changing `desktop/`: follow the skill **desktop-change** (`.claude/skills/desktop-change/SKILL.md`): the fast
   edit → check → push loop and the traps that caused real bugs. Screens: skill **ui-look-and-feel**.
6. Humans and agents alike: [CONTRIBUTING.md](CONTRIBUTING.md) (the change loop, where things go) and
   [RELEASE.md](RELEASE.md) (pre-releases, `tools/release-stable.sh`, what updates on a friend's side).
7. New file: start it with a one-line comment (docstring in Python) saying what it's for; `node desktop/scripts/codemap.mjs`
   then updates `CODEMAP.md`.

## Working rules
- Code changes happen in a git worktree on their own branch (see AGENTS.md → Working with git); other agents work on this repo at the same time.
- After each change: tests pass → commit → push to `main` → update Notion (hub current state, Run Log, Technical Reference; Decision Log when a decision changes; Handoff "Current state" / "Open threads" at the end of a session).
- Wrong data is a bug: fix the root cause in the code first, so it cannot happen again (with a regression test), and push; then repair the owner's existing rows by hand through the Notion MCP (read them, change only what is wrong, say what changed). Never build code meant to be used once for one specific / edge-case repair (no one-off migration, backfill or tidy command/button for the owner's data). Product code is fine when every user needs it: schema evolution (a new column + its backfill) and runtime guards that prevent the problem.
- Ask before spending money on AI (new model or large re-runs); show measured cost.
- **Every fix works for any user, through the Desktop App.** When something is set up, repaired or unblocked by hand
  (a terminal command, a Keychain read, `gh secret set`, a Notion edit), that was a product bug: build the same step
  into the app (automatic where possible, else one clear button or wizard step) and test it, then say which. Nothing may
  depend on the owner's machine, CLI tools or access. Example: Always on now copies the Google sign-in to the user's
  GitHub repo itself (`desktop/lib/google-keys.js`), after it was once set with `gh secret set` by hand.
- **Keep the website's Intelligence page in step** (`site/public/intelligence.html`, its teaser in `index.html`, the README block "AI at every step"): any new AI step, rule or guidance a user can see gets an entry there in the same change, with the count updated (owner, 3 Oct 2026).
- **Meaning comes from AI, never from keyword lists** (owner, 8 Oct 2026: "AI should interpret mails"): emails, pages, buttons and form
  questions arrive in any language. Fetch by structure, let AI decide with a fixed answer the code knows, keep it per item; a word list
  (even one AI wrote) may only be a free shortcut in front of the AI, never the filter. Example: `src/ai/mail_triage.py`.
  One mechanism: engine `src/ai/decide.py` (fixed answers, kept per item in `decisions`); each decision with its no-AI rule lives in
  `src/ai/meanings.py`. Rule placement: high-volume items (titles, links) take the rule's yes for free and send the rest to AI;
  few high-stakes items (form questions, buttons, emails) are decided by AI, the rule answers only without AI and stays a safety floor.
- **Universal first (owner, 8 Oct 2026): any website, any form, any language.** Avoid hard-coding; rely on AI decisions with fixed answers (global rules: "Universal first"). Account pages are the example: the page-kind AI names the step (sign in / sign up), the register control and the submit control; code keeps only structure and safety floors.
- **Judgments about a page are the AI's, even when no word is matched** (owner, 8 Oct 2026, after "is the form ready?" was HTML `required`, "did it work?" was "the form is
  gone", and bot checks were a list of vendors: all three failed on the first real site). Structure may only **find** a control (type, position, attribute) and enforce a
  **safety floor** (one press per tab, never a consent, no AI = nothing pressed). Whether a page is ready, what became of an action, what a message means, whether something is a
  bot check, which step of a journey this is, is **decided by AI with a fixed answer the code validates** (examples: `desktop/lib/page-kind.js`, `account-judge.js`). A floor may only
  AND with the AI's answer, never decide alone. **Before writing code that decides anything about a page, say in one line which of its decisions are AI, which are structure
  (finding only) and which are floors; if one is a heuristic (HTML flags, "the element disappeared", a list of vendors, words, regex), make it an AI field instead.** The test: would
  it still work on a site, language and widget I have never seen? Guard: `tools/hardcoded-page-words.mjs` (ratchet: no new vendor list or natural-language regex in extension/ or desktop/lib/).
- **Reading websites is universal** (owner, 8 Oct 2026: "we'll have thousands of them"): no fix for one website, no growing regex or word lists; where a rule would need special cases, let AI choose from what the page offers and keep its answer per site. Detail: AGENTS.md "Reading websites".
- **Validate a form fix on the real extension** (owner, 8 Oct 2026: "for better validating"): unit and shape tests do not load the extension, so after
  a fix to form filling (`extension/page/*`, `fill-flow.js`, flows) also run `cd desktop/e2e && npm run real-extension` (headless Chrome, the real extension and
  panel, a real Coop form, isolated: `desktop/e2e/lib/real-extension.mjs`). Prove the test with a positive control: `REAL_EXTENSION_DIR=<the build from
  before the fix>` must fail it. A new case gets its own test there on a real site that shows it, always through `startRealExtension` (never a hand-rolled
  launcher: it cuts off the live app, profile, CV, Keychain and AI, and asserts it). Say in the reply what it showed.
- **Tests and automation never touch the owner's live app, accounts or real data** (8 Oct 2026: a headless browser with the real extension, launched
  without the harness's port rewrite, paired with the live app on 127.0.0.1:47111 and used the real profile, the Keychain password, the real CV and AI
  budget on an employer's site). Before running product code, list what it reaches (ports, apps, Keychain, tokens, real profile/CV, paid APIs), cut each
  off and assert it in the script. Extension in a browser: always `desktop/e2e/lib/extension.mjs` (`copyExtension` + `freePort`, then check the storage
  points at that port); never a hand-rolled launcher. A real third-party site only with fake applicant data and the fixture CV. After a run, check the
  live app's `logs/app.log` has no lines from it. Global rule: `~/.claude/CLAUDE.md` "Tests and automation never touch live apps".
- **The one sanctioned exception: a live-test twin** (owner, 8 Oct 2026: "test on my current state, on my live websites… while avoiding mutating my
  actual Notion state"). To validate a fix on the owner's real state and real sites, run `cd desktop && npm run twin` ([docs/live-test.md](docs/live-test.md)):
  a second app in twin mode (`desktop/lib/twin.js`) on a fresh clone of the real folder, its own window, port and Chromium, Notion replaced by the one-way
  mirror "🧪 Job Pilotto – Live Test" (synced at start; its token is checked to get 404 on every real database). Never the owner's app window, Chrome
  windows, Telegram or real Notion; never Submit; never read a password field. A new outward path in the app (a sender, a schedule, AppleScript) gets its
  twin guard in the same change (`desktop/test/twin.test.js` lists them).
- **A form bug is fixed in the self-improving mechanism, for every install** (owner, 8 Oct 2026): a field, control or upload slot a form leaves
  unfilled is never fixed "for that website". Say first which part of the mechanism it improves (operator, fingerprint, meaning in the alias pack,
  recipe, noticing the miss); test the SHAPE with a fixture (the real site only as one live sample); a variant still unhandled must be reported
  with its fingerprint so a recipe or meaning can be added as data, and listed for the person, never skipped silently. Notion: "Self-improving
  form filling: design & plan". Example: upload slots (`extension/page/upload.js`, `desktop/e2e/test/upload-slot.test.mjs`).
- Never auto-apply to jobs: the application kit drafts, the owner submits. LinkedIn, Glassdoor, Indeed, levels.fyi and Reddit (owner, 7 Oct 2026): read through the user's own visit (the extension's "Read the jobs on this page", started by their click, in their tab) or when a page answers plainly; never log in automatically, never get past a login wall or a bot check (401/403/429 or a check is a no); elsewhere public APIs and job feeds.
- Secrets live in the macOS Keychain (`job-pilotto.*`), GitHub secrets and Cloudflare Worker secrets — never in code or Notion.

## The change loop (Superpowers plugin dropped 30 Sep 2026: its process cost more tokens than it saved)
- Worktrees: `tools/worktree.sh <topic>` (`.claude/worktrees/`).
- Finish: `tools/ship.sh` (rebase on `origin/main`, the hook's tests, push with retry, update the main checkout; no local merge, no PR unless asked), then Notion. **Pick a change tier first and say it** (AGENTS.md "Change tiers"): most changes are Tier 0/1 (~1–5 min); stop when the tier is met.
- **Pick the test method that can show the thing** (AGENTS.md "Which test for which question"): unit for logic, `shot` for a screen, a fixture for a
  control's shape, `real-extension` for the extension alone, `flows` for a flow file, the twin (`npm run twin`) only for what needs the owner's real
  state or real sites. Every live finding ends in a test that fails without the fix.
- **Commit subject: one line, at most 72 characters** (GitHub cuts the list at about that, 2 Oct 2026: subjects of 150+ characters
  with version numbers and reasons made the history unreadable). Imperative, what changed: `Extension: drop "Use on this tab"`.
  No version number, no reasons, no "because…" in the subject; those go in the body (blank line, then wrapped text).
  The hook stops a longer subject at `git commit` already. One that got through blocks the push: `git commit --amend` your own
  unpushed commit, or, if the amend is denied, `COMMIT_LONG_OK=1 git push ...` (never rewrite a pushed one). Attribution lines stay at the end of the body.
- Small changes (a label, a style, a one-file fix): edit → one suite → push.
- No subagents (owner, 30 Sep 2026: they ate most of the token usage and were slow): do the work inline with your own
  tools. Only when the owner asks for one.
- The four habits that prevented rework (24–29 Sep Run Log):
  1. A bug the owner saw: find the root cause and write a failing test before any fix (Notion 429s took 3 rounds).
  2. Tests first for new behaviour; watch the test fail for the right reason.
  3. UI from an owner mockup or request: confirm layout + behaviour in one message before code (Profile moved and back,
     Settings saving changed twice, Actions redesigned 3× on 28 Sep).
  4. "Done" = tests pass as CI runs them (`JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs python3 -m unittest
     discover -s tests`, desktop `npm ci` with dev deps); say what you verified and what you didn't.
  5. **A feature or behaviour change updates the e2e step it breaks, in the same commit** (6 Oct 2026: about 25 commits in eight hours renamed a task, changed
     digest headings and the job-board rule without touching their suites, and the manual `personas` suite sat red unnoticed). Before you push: `grep` the visible
     words, selectors and commands you changed in `desktop/e2e/` (`suites/`, `lib/`) and the unit tests; fix what you find, or say in the commit body which step
     is now stale and why. A new detector or plant needs its unit test page to carry what it checks (`test/recall.test.mjs`).
  6. **A new e2e step is seen passing before it lands, and proves its own setup** (6 Oct 2026: an Apply step that had never passed failed the beta gate on its
     premise: a missing board was meant to make the kit fail, but kits draft from the posting). The push hook (`tools/new-e2e-steps.mjs`) wants a local run that
     passed it, or `E2E-unverified: <why>` in the
     message. In the step, assert the setup took effect: the proxy/stub was called, the seed is in the state, the failure really happened.
  7. **Never start a CI e2e run by hand; run the suites locally** (owner, 9 Oct 2026: a Mac's e2e runs on Claude Code or Codex, the plan, so it costs no API credit;
     CI spends the test keys). No `gh workflow run e2e.yml`, no `e2e-try/*` tag, unless the owner asks for one (a beta gate by hand). The scheduled and release runs
     stay as they are. Prove a step with `cd desktop/e2e && E2E_STEPS=... node run-all.mjs --only <suite>`; `E2E_AI_FAMILY=openai` runs the OpenAI side on Codex.
- Big features (Always on, migrations, Apply with Claude): a short spec in `docs/superpowers/specs/` with a
  "Data ownership" section (Notion vs cache) before code; link it from the Notion Decision Log, don't copy it there.
- **A big change (a feature, a migration, a refactor): slices, a safety net first, ONE full run at landing** (owner, 10 Oct 2026: the ladder took 40 checklist boxes and the full suites ran about 40 times; "do it in 1 to 3 commits and run the e2e suites 10x less"):
  1. **Size it first** (Tier 0/1/2). Above Tier 1: a spec with a checklist (`docs/superpowers/specs/`; one box per provable step, bars from `tools/ladder-progress.mjs`-style reports), and say what stays unverified.
  2. **Safety net before behaviour:** fixtures, a baseline and a gate (the ladder's `ladder-score`, `tools/ladder-gate.mjs`, recorded pages, contract and architecture tests) exist BEFORE the change; they replace re-running everything by hand.
  3. **Three speeds of checking:** each edit runs only the touched test (seconds); each finished slice runs the gate and the replays it touches (1-2 min); the FULL suites, all replays, real-extension and the old-build controls run ONCE per landing, in the background (`run_in_background` + Monitor). Never the full suites per commit. Extension version, fingerprint and codemap are written once, at landing (a second write at the same version is refused: `git checkout origin/main -- extension/fingerprint.json`, then write).
  4. **Commits:** small local commits are free; what lands is 1-3 squashed commits by concern. The review unit is the slice, not the commit.
  5. **Parallel sessions by file ownership, not by task:** one session owns the flow core; others get new files, tests, the site, measurement (brief + own worktree + commit only + report; the coordinator merges and lands). Fix the landing order and any freeze window up front and message every peer.
  6. **A migration or move is its own pure commit,** in a quiet window announced to all peers, after the safety net, never mixed with behaviour changes (an architecture test pins the allowed imports).
  7. **Measure per source** (real / reconstructed / invented), never blended, and never tune on invented data.
- Weekly self-review (`.github/workflows/weekly-self-review.yml`, Sun evening): Claude reads the week's commits/CI/issues and
  opens a `self-review/<date>` PR editing these rules or skills. Proposals only: the owner merges.

## Data ownership: one copy of everything, behind the store interface
**Changing since 9 Oct 2026 (owner): Notion becomes optional.** The user's data lives behind one store interface,
`src/stores/` (`open_stores()`; adapters `sqlite` = the default for new users, `notion` = today's code, more later; every
adapter passes `tests/store_contract.py`). A user moves to Notion only when they choose ("Move my data to Notion", one-way,
never a sync); Always on needs Notion. New stored data goes through the interface and every adapter, never straight to
Notion. Spec and owners: `docs/superpowers/specs/2026-10-09-store-adapters.md`. Until its pieces land, the rules below
still describe the code; read them as "the active store" where they say Notion.

Data is Notion-first. Before adding any stored field, file, setting or table, decide where it lives:
- **Notion** — anything the user reads, edits, or would want on another device: statuses, run results,
  profile/answers, open questions, contact details, learned form notes, search settings, transcripts.
  The code reads it from Notion; it never keeps a second editable copy.
- **The Mac / runner** — only keys (encrypted), large files and caches that can be
  deleted and rebuilt from Notion or a crawl (`jobs.sqlite`, `config/*.json` as the cache of ⚙️ Search
  settings, `runs.json`). A cache is refreshed *from* Notion; writes go to Notion first, and if Notion
  refuses, nothing changes locally and the user is told.
- Files: the CV (every version, Profile → "📎 CV") and tailored CVs (Applications → "Tailored CV") are uploaded to
  Notion too (`desktop/lib/files.js`, ≤ 5 MB on Notion's free plan). What's too big (call recordings) is only on
  the Mac and in the weekly automatic backup (`desktop/lib/backup.js`: iCloud Drive or Documents, last 4, no keys).
- Notion is required to **track**, not at setup ("Notion later", decided 3 Oct 2026, replacing "required at setup" of
  28 Sep): the setup finishes without it and the app is then only **trying**: search, fit scores, the Jobs list and
  Strategy. Every tracking action (save, dismiss, kit, apply, applied elsewhere, add job, leads, interviews, Focus,
  Gmail, Telegram, Always on) answers `notionGate.needs(reason)` (`desktop/lib/notion-gate.js`) and the window opens the
  connect prompt (`renderer/pages/notion-connect.js`; `preload.cjs` turns any such answer into that prompt and retries the
  action after a connect). The only user data on the Mac while trying is `profile.md`, `answers.md` and the search config
  cache; `lib/migrate.js` 'strategy from this Mac' moves them into Notion at connect (a new workspace takes this Mac's;
  an existing one wins) and deletes them. No other local copies: a feature that stores user data goes behind the gate.
  Always on never moves data (it changes where runs happen, not where data lives). Spec: `docs/superpowers/specs/2026-10-03-notion-later.md`.
- No new "local fallback" copies of user data, and **no cache-only fields**: if a screen or command needs a
  field, it is a Notion column. A feature that needs a new database, column or page adds it to Notion *and* to
  `config/notion_schema.json` (`tools/notion_schema.py snapshot`, or edit it), so every workspace can be rebuilt
  and repaired (`desktop/lib/schema.js`, at connect and start-up). Existing rows get the value backfilled.
  `tests/test_notion_schema_coverage.py` fails when the code uses a column the schema lacks, and
  `tests/test_notion_docs_coverage.py` when a schema column isn't in `docs/notion-schema.md`: after adding one, run
  `python3 tools/notion_schema.py docs` and write its Notes. (`config/notion_template.json` lists only the columns
  checked at connect; don't add optional ones there, the app adds them from the schema.)
- **Job Matches = what a search found and scored; Applications = every job you pursue** (found or added by hand/from a recruiter, with its fit columns): added jobs and leads get no Job Matches row (decided 30 Sep 2026).
- The desktop Jobs list is built from Notion (Job Matches + Applications, `Tracker.notion_jobs`), with Notion's
  fields only; the cache is kept in step and only adds jobs a search couldn't write to Notion yet (marked).
- **The employer index is product data, not user data:** the central scout (private repo `job-pilotto-internal`) publishes feeds +
  quality + last verified to our website (`GET /api/index`, `site/src/employers.js`; needs an install token and is capped per install a day, `site/src/guard.js`: tokens per purpose, revocation, honeypot recipes and access flags on /telemetry; the token is enforced since 2 Oct 2026; `INDEX_GATE=soft` in `site/wrangler.toml` would reopen the list temporarily); every run downloads it (`src/employer_index.py`,
  cache `data/employer_index.json`, checked about hourly; the central scout publishes every 6 h) and merges it with the starter `config/sources.json`. Worldwide, each feed lists its places; a run crawls only feeds matching the user's own `search.json`
  (`employer_index.relevant`). It never lives in
  users' Notion, and nothing about a user is sent to get it. The owner's Notion Employers & Sources stays their own list.
- Moving existing local data to Notion: add a step to `desktop/lib/migrate.js` (delete the local copy only
  after Notion confirmed it has it) and a test.
- Every run (search, Gmail check, kit, review, insight, report, find employers) leaves a row in ⏱️ Search runs,
  wherever it ran (the Mac, the user's GitHub repo, a Telegram button): opened at the start (Status Running,
  `cron_runs.begin`, with a ⏳ progress line in Summary), completed at the end with its report, its **Result**
  (the message it sent or showed) and a **Technical log** toggle. That row is the one run history: the app's
  Recent activity (`desktop/lib/run-history.js`) and Telegram /status read it; `runs.json` is only a cache.
- Background jobs run in exactly one place: the user's GitHub repo when **Always on** is on (the old "Keep working while my Mac is off")
  (app buttons, Prepare, interview review and the first search included), else this Mac. Only what needs the Mac
  (recording/transcribing, Apply with Claude, form filling, Google sign-in) or an instant answer runs locally.

## Desktop UI: one design system
- **The window is one module per page** (`desktop/renderer/pages/`: focus, jobs, sessions, session-needs, session-log,
  strategy, settings, interviews, activity…); `renderer/app.js` only runs each page's `init()` in order. Helpers every
  page uses are in `pages/core.js`; state more than one page *reassigns* lives on `shared` (`pages/shared.js`), since an
  imported binding is read-only. Put logic that can be tested without a window in its own small module
  (`renderer/session-message.js`, `session-state.js`, `wheel.js`) with a test in `desktop/test/`.
- `electron .` works in any worktree: the entry `desktop/start.js` builds `shared/` when it's missing, and a test run
  (`JOB_PILOTTO_SMOKE…`) that can't start prints why and quits: no crash dialog on the owner's screen.
- **Checking a UI change:** `npm run shot -- <page>` (one screen, ~5 s) or `--eval "…" --no-picture` to read the
  window's state (`window.__jp`) as JSON; `--reload` tests after ⌘R. The full reference set (`npm run ui-shots`)
  is only for big changes, about daily, or when the owner asks (details: skill `ui-look-and-feel`).
- **Before building or changing any screen, read the skill `ui-look-and-feel`** (`.claude/skills/ui-look-and-feel/SKILL.md`):
  the reference screenshots (`desktop/docs/ui/`, refreshed with `npm run ui-shots`), the page and card patterns the
  owner approved, and how to render your change in demo mode and look at it before saying it's done.
- **A new feature looks like the old ones (5 Oct 2026: "Prepare top matches" shipped as raw Telegram text while every other task had a card).**
  Whatever a task, run or message shows in the window, find the nearest existing one first (`pages/activity.js` render*Card,
  `components.js`) and reuse its card/component; never show engine or Telegram text in a `<pre>`. So a new task kind needs, in
  the same change: (1) a parser for its message + a render*Card on the insight-card shape, with a test; a line for its message in `desktop/test/fixtures/engine_messages.py` (made by the engine's OWN writer) and a case in `engine-message-contract.test.js`, so a format change on either side fails a test (5 Oct 2026: four cards had drifted); (2) its kind in
  `CARD_KINDS` (`renderer/run-cards.js`) so the Finder's `card-fallback` check covers it; (3) a look at the rendered result
  next to a sibling task's. Not done until it passes that comparison.
- Values live in `desktop/renderer/tokens.css` only: colours, corner radii (`--r-sm|md|lg|pill`), the type scale
  (`--fs-…`), fonts, spacing (`--sp-…`), shadows. Screens use `var(--…)`. `desktop/test/design.test.js` fails on a
  raw colour, radius, font size or font family anywhere else, so a new one-off value can't reach `main`.
- Building blocks come from `components.js` + `components.css`: `pill(text, tone)`, `tag()`, `tile()`,
  `moreButton(items)` (the ⋯ menu), plus the button classes (`primary`, `secondary`, `ghost`, `link`, `danger`,
  `with-icon`). Use them; if a screen needs something new, add it there (modifiers are `is-…`, tones `tone-…`)
  and to `gallery.js`, rather than styling it once in `style.css`.
- `npm run gallery` (in `desktop/`) shows every token and component on one page; check it after changing one.
- New colour or size? Add a token (and say why) instead of a literal. The website (`site/`) has its own styles.

### Every new screen and action goes in the ⌘K palette
The command palette (`paletteCommands()` in `desktop/renderer/pages/nav.js`) is how a person finds anything without knowing the page. A new page is a `.nav` button (listed automatically).
A new Actions card needs `data-command` (a Telegram command) or `data-palette` on its Run button (`test/palette-covers-actions.test.js` fails otherwise). Any other new top-level
button a person would look for (Add a job, Log activity…) is added with `button(view, id, keywords)` in `paletteCommands()`. A long or paid action opens its card and focuses its
input instead of running at once. Settings needs nothing: every page, section (by its heading), Connections card and button there is listed from the page itself
(danger-zone buttons are focused, not pressed), checked by the settings suite's ⌘K step. A new long task that runs on this Mac is a tracked task (`pipeline.work` / `pipeline.task`), so the banner, Recent activity and the result follow it.

## Files: one concern each, never over 500 lines (owner, 8 Oct 2026)
A big file is read in parts, so an edit misses shared state and imports far away, and sessions editing it at once collide (8 Oct: a moved
block missed `sessionGet` 800 lines below; an import changed upstream and a page went blank). **No source file (.js, .mjs, .cjs, .py) over
500 lines.** About to cross it? Move a concern into its own file first (the pattern: `lib/session-flow.js`, `extension/fill-flow.js`: shared
state passed in, a header naming what it owns and the tests guarding it). Files already over it are in `tools/file-size-allowed.json` at their
size and may only shrink; `tools/file-size.mjs` (push hook + `desktop/test/file-size.test.js`) fails a new big file or a listed one that grew.
**Documented exception (owner, 8 Oct 2026):** `extension/review.js` stays over 500 on purpose: Chrome injects it as ONE classic
content script (no imports without a build step, or without exposing modules to every page). It may not grow; the reason lives in `EXCEPTIONS` in `tools/file-size.mjs`.
A classic page script can still be split: `extension/page/fill.js` became six files on 9 Oct 2026, injected in order (`extension/page-files.js`) and sharing helpers through one window object (`window.__jobPilottoFillKit`).

### Splitting a file safely (8 Oct 2026: main.js 2,781 → 1,197 lines, a failed start and three near-misses)
- **Pure move, nothing else.** Same code, same names; a new file starts with a header: what it owns, which tests guard it.
- **State:** a `let` that is reassigned stays ONE binding: pass a getter (`getWindow: () => window`) and, if the module sets it, a setter. Never
  pass it by value (it freezes `null`). State only the moved code touches moves with it. Values `main.js` still needs from the module come back
  as a return value, and the groups that use them are registered AFTER it (`prepareKitFor` was needed before it existed: the app did not start).
- **Calls stay put:** `register…Handlers(` calls of earlier splits that sit inside a range you cut stay in `main.js`; imports `main.js` still needs
  are restored from `git show HEAD:…`, never guessed. Ranges drift whenever imports above them change: recompute them from names, not numbers.
- **Prove it runs:** tests that read `main.js`'s source read it through `test/main-source.js`; then START the app (`npm run shot -- sessions`),
  because registration order and unset bindings only show at start-up. A flow file moved is a flow file: add it to `FLOW_FILES`, run `npm run flows`.
- **Land fast:** `main.js` and the big pages are edited by several sessions a day; rebase right before the push and port what others changed in
  the moved range (a session had split the contact handlers meanwhile: two files registering one channel).

## The extension first, Claude as the safety net (owner, 8 Oct 2026)
The plain **Apply** button (the Chrome extension alone) is the product: easier, faster, simpler, and aimed at **non-technical users first**.
Every step of an application (posting → Apply → account sign-up/sign-in → email confirmation → the form) is built for the extension to do
end to end. **Apply with Claude** is the backup: offered (a button, never started by itself) when the extension can't finish a step, and
chosen by technically advanced users. A new capability goes into the extension's flow first; "Claude can do it" is not a reason to skip it.
**Claude finishes a stuck page** (owner, 10 Oct 2026; spec `docs/superpowers/specs/2026-10-10-claude-finishes-stuck-pages.md`; replaces the 9 Oct "Claude hidden, off by default" and the 8 Oct "never started by itself"):
- Offered only when Claude is READY (`lib/claude-ready.js`, window twin `renderer/claude-help.js`): a Claude engine, Claude Code installed and signed in (Git on Windows). No "Show Claude help" switch; a non-technical user has no Claude Code, so never sees it.
- On the stuck page the panel (`extension/panel-claude.js`, its own classic script; `review.js` only shrinks) and the session card (`renderer/claude-offer.js`) offer: Let Claude finish this page · I'll do it myself · ☐ Always let Claude finish when I'm stuck (`settings.claudeAuto`). The first press shows one consent line (Continue stores `settings.claudeConsent`). With "always" + "Do it for me" the panel counts down 5 s with Cancel, then starts; "Let me check each step" never counts down. A notice opens the card once per session.
- Floors: never Submit, never a captcha or SMS code; **at most one takeover per application** (`lib/take-over.js`, refused and logged). Flow-core invariant 2 of `session-flow.js` changed on purpose: it only offers; the person's press or the visible countdown starts.
- Claude teaches the extension (`lib/takeover-teach.js`): controls Claude filled that the extension had left are reported by fingerprint as failed outcomes without a recipe (counts only), which lists them as the proposer's targets.
- New accounts get their own generated password per site (`passwords new`; accounts made before keep the old shared one), and the session card records "Account created on X · terms accepted: '…' · code from your email" (`application-journey.js` invariant 6).

## Test a flow live, on a real site, in a window the owner can watch (owner, 8 Oct 2026)
Fixtures prove a flow's SHAPE; only a real site shows what it really does (a sign-up page, a bot check, a stall). So when a flow touches real
sites, run it live before and after a change, not only the matrix:
- **How:** `cd desktop && npm run live` (LIVE_URL=<posting>, LIVE_LIKE='%host%', LIVE_SECONDS=120): the e2e app (its own profile and Notion test
  page, never the owner's data) + a visible Chrome with the real extension, on a real posting read read-only from the owner's job list
  (`e2e/lib/apply-live.mjs`). It presses Apply through the app's own API and prints a timeline (page kind, stage, fill state, the app's
  extension/review log lines). It presses nothing on the page: no account button, never Submit.
- **Which one:** `npm run live` is the quick run (the e2e app and its test workspace, a real posting, no sync, about 3 minutes); `npm run twin` ([docs/live-test.md](docs/live-test.md)) is the owner's real state mirrored. Live first, the twin when the owner's own data matters.
- **A held run says so** (`HELD by the live test` in the log, the start banner and the stall report: LIVE_SUBMIT=1 lets the consent and the account button through); before starting one, tell the owner what the window will and will not do. Poll short (see the global rule "Watching a run the owner can see").
- **Use it for any flow** (apply, account, visit, mail): add a `runLive`-style step to the suite, same rules: read-only on the owner's data,
  test workspace for writes, nothing irreversible on a real site without the owner saying so.
- **Report what it shows**: what worked, what did not, what the log cannot tell (then add the log line). The owner's own app window and
  Chrome tabs I cannot drive; the harness's I can.

## The assistant mode: "Do it for me" or "Let me check each step" (owner, 10 Oct 2026; was "Account automation", 8 Oct)
Two modes, one choice (Settings → Profile → Application assistant, `renderer/assistant-mode.js`), stored as `settings.accountAutomation` and read only through `automationOf`
(`desktop/lib/site-accounts.js`). **full = "Do it for me", the DEFAULT** (owner, 10 Oct 2026: "users get most of the automation by default"; it replaced the 9 Oct assist
default): on an account page the extension accepts the account's consent (as the account AI names it, `needs_kind: consent`, at most 3 presses per tab) and presses the
account button, the confirmation link from the mail is opened, or its code typed into the box the account AI named, when Gmail is connected (the code is never
logged; `lib/account-confirm.js` `codeFromMail`, `extension/account-fill.js` `fillCodeBox`), and the closer look (`lib/escalate.js`) runs on an unclear account page (a screenshot,
typed values hidden, at most 10 a day). **assist = "Let me check each step"**: it fills, the person does the consent, the button and the codes; no closer look. Never in
either: an application's Submit, a captcha or bot check, an SMS code, a choice or consent on the application form. The setup asks the choice once (Yes is pre-selected).
Changing what a mode does or its default is the owner's call, with a Decision Log entry.
## Applying flows: change one, run them all (owner, 8 Oct 2026)
A fix for one flow (account creation) must never quietly break another (the application form). **[docs/flows/applying.md](docs/flows/applying.md)** is the map:
the one page decision (the AI's kind, `desktop/lib/page-kind.js`; `extension/tab-pages.js` `pageRole` only without AI), every scenario, its code and its guard. Touching the decision core (`FLOW_CORE` in `desktop/e2e/flows.mjs`: which page is what, which tab is whose)
→ its steps run with every other e2e on CI (`apply`, `applycv`: the schedule and the beta gate); the browser matrix is no push gate (owner, 9 Oct 2026). **The journey gate is** (owner, 10 Oct 2026): a push touching any flow file runs the applying scenarios as event sequences (`tools/journey-gate.mjs`, `JOURNEY_TESTS` in `desktop/e2e/flows.mjs`, seconds, no browser); a live bug becomes a scenario in `desktop/test/journeys.test.js`, failing first. Where an application stands has one owner: `desktop/lib/application-journey.js` (app) and `extension/tab-identity.js` (which application a tab is); spec `docs/superpowers/specs/2026-10-10-application-journey.md`. `cd desktop && npm run flows` (whole matrix, ~5 min) stays an on-demand check for a big flow change.
To chase one step locally: `E2E_STEPS='the app has an applicant,<journey>,<step>' node suite.mjs applyflows` (needs the setup step and a browser-launching journey before it).
Other flow files: their area's suites plus the best-fit method (AGENTS.md "Which test for which question"); the matrix before a release and on demand.
A new scenario gets a row there and in `MATRIX`, with a step or test that fails first. Never add a second page classifier.

## The flow core: one session at a time, invariants first (owner, 10 Oct 2026)
Why: in 8 days `extension/background.js` took 48 commits and `fill-flow.js` 29, from several sessions at once; a fix for one site or flow kept breaking another.
- **Claim it before editing** `FLOW_CORE` / `FLOW_FILES` (`desktop/e2e/flows.mjs`): one message to every peer ("I own the flow core until I say released"), and
  "released" when done. A peer holding it: wait, or send your change to them. No new applying feature while a journey refactor is landing.
- **Read the file's "Invariants:" block first** (the top of each flow-core file). Changing an invariant is the owner's call: say so in the commit.
  A new invariant gets its test in the same change (`desktop/test/flow-invariants.test.js` fails on a core file without the block, or one naming a missing test).
- **A live bug becomes a scenario first** in `desktop/test/journeys.test.js` (it must fail on the old code), then the fix; the journey gate runs them on every push.
- **Never fix the same website twice: four layers** (owner, 10 Oct 2026; spec `docs/superpowers/specs/2026-10-10-applying-reliability-layers.md`):
  1. journey scenarios (`desktop/test/journeys.test.js`, every flow push); 2. **recorded pages** (`desktop/e2e/recorded/<shape>-<n>/`, `npm run recorded` in
  `desktop/e2e`, replayed by the journey gate when the extension changes): a fixed site's pages, captured from the twin with
  `npm run twin:drive -- capture <tab> <case> <page> <your worktree>/desktop/e2e/recorded` (scrubbed; `desktop/test/recorded-privacy.test.js` keeps personal data
  out of this public repo), named by shape, seen failing on the old build (`REAL_EXTENSION_DIR`); 3. the nightly live smoke; 4. per-board drops in the digest
  (`/admin/form-filling/digest.json`, `boards[].dropped`). **A push changing how the extension acts on pages must add a recorded page or a scenario**
  (`tools/recorded-cases.mjs`, push hook). A field replay (`worker/test/fixtures/fill/`) is a second layer, never the proof: it does not reach the Fixed-site replays list. The recorded page must **fail on
  the build before the fix** (`REAL_EXTENSION_DIR=<old extension/>`, name the failing check in the commit) and its stubbed AI answers only what the extension asked (an answer to an unasked question hides
  the bug: 10 Oct 2026, Ashby Yes/No). `Recorded-unneeded: <why>` is only for a change that fixes no failure seen on a real site (a log line, a comment, a refactor), never for a site's fix.
- **One owner per state:** where an application stands is `desktop/lib/application-journey.js` (app) and `extension/tab-identity.js` (which application a tab is);
  never a new field or storage key for it elsewhere.
- **The ladder: fix a site at its rung** (owner, 10 Oct 2026): a page decision climbs rung 0 structure rule, 1 kept answer, 2 text sketch, 3 numbered digest, 4 closer look
  (screenshot), 5 Claude takeover, 6 the person; a rung that is unsure or contradicted hands the page up, never guesses (`extension/ladder/core.js`). Map: `docs/flows/ladder.md`; skill `fix-failing-forms` (its rung method); progress: skill `report-progress` (any spec with a `## Progress` checklist).
- **Fix at the LOWEST rung that has the information, data before code** (a kept answer, a recipe, a prompt example); never a site name, vendor list or word list; never in a higher rung what a lower one can see.
- **A fix cannot break another site:** `desktop/e2e/ladder-fixtures/` (real sketches, recorded pages, traps) + `desktop/e2e/ladder-baseline.json`. `cd desktop && npm run ladder-score` (live, plan path, no API key) and `-- --offline` (stored answers);
  `tools/ladder-gate.mjs` (push hook) fails a flow push that makes a fixture worse. A fixture only gets better through `npm run ladder-score -- --offline --update-baseline "<why>"`; never edit an expectation to pass. Rates are per source (real / reconstructed / invented), never blended.
- **A new shape from the pool or a live bug first becomes a fixture** (`node desktop/e2e/ladder-capture.mjs`), seen wrong, then the fix; `Recorded-unneeded` rules are unchanged.

## Facts that are easy to get wrong
- **A ⏱️ Search runs row's `Summary` is only the report's first line** (`src/notion/cron_runs.py`,
  `Summary: _text(lines[0])`). The rest — where a GitHub run's `Warning: …` lines are — is the page's Report bullets:
  `desktop/lib/run-history.js` `detail()` returns them as `report`, and `renderer/run-warnings.js` `runWarningLines()`
  reads log + report. A row can say `Status: Warnings` with no warning text on it at all, so a list's pill and a
  detail's card must agree by construction, not by luck.
- **"Show exactly these jobs" is `showJobsIn(label, urls, from)`** (`desktop/renderer/pages/jobs.js`), matching on
  `fullKey(url)` (trim + one trailing slash). A "View all N" button must call it *and* count N with the same key, or it
  promises jobs the list doesn't hold (30 Sep: a run's card said 9, the page showed 8 — the ninth was a "new since last
  run" posting that was never scored, so it had no Job Matches row).
- **The digest has two item shapes**: "New since last run" lines end ` - 100%` (a title-match percentage); "Best
  matches" lines carry `· 🎯 83` (the fit score). `desktop/renderer/run-cards.js` parses both: the percentage belongs
  beside the company, the fit in the pill — read as part of the title it put "… - 100%" next to "Not scored".
- **Feed the warning helpers raw lines.** `limitedJobs` / `warningSummary` / `groupWarnings` read the pipeline's own
  wordings ("N job(s) not read by AI", "… left for the next check", "Skipped job <id>: …"); `humanError` is for what the
  owner reads. The API's JSON dumping must never reach the UI.

## Layout
- Python package `src/` (run with `python -m src <check|scout|discover|feeds|enrich>`; `check` = the jobs check, also still `daily`; `scout` = Find new employers): `daily.py` orchestrates a run; `digest.py` ranking/rotation/paging/layout/buttons; `telegram.py` sending; `store.py` SQLite; `scout.py` source scout; `paths.py` repo paths; `features.py` optional-feature registry and the `JOB_PILOTTO_DISABLE` switch (only the crawl + digest core is required; new features must be optional, on when their keys exist, and listed there).
- `src/sources/` (`ats.py` feed adapters, `feeds.py` employer-feed crawl, `boards.py` jobs.ch/TechTree), `src/ai/` (`enrich.py` stage 1 Haiku 5.5, `score.py` stage 2 Sonnet 5, `kit.py` application kit Sonnet 5 on 📝 Prepare or auto-drafted, `apply_batch.py` queues kits into the ChatGPT/Codex desktop app, `insights.py` daily insight + Monday weekly report: code stats + Sonnet 5 → Telegram and 💡 Insights, `interviews.py` recording/transcript/notes → 🎤 Interviews rows (the app saves transcripts there, linked to the job; Notion is the database) and their review, `transcribe.py` local audio → transcript with speakers (optional add-on `requirements-transcribe.txt`: sherpa-onnx with Silero VAD, Parakeet-TDT v2 English, pyannote + 3D-Speaker ERes2Net), `mail.py` Gmail + Calendar → events/Stage/Next interview/prep messages; client in `src/sources/google.py`; `opportunity.py` a recruiter's message (Gmail "Recruiter outreach", Telegram `/add <message>` or a forward, the app's Jobs → Recruiter message) → Applications row at Stage Recruiter lead; `inbox.py` "log anything": a pasted message or screenshot (bot photo/forward/`/add <text>`, the app's Log box with "Which job?") → matched against Notion's jobs (Claude + `same_job` fallback) → that job updated, or a new row; screenshot uploaded to the job's page; in the app two steps: `--propose` (the one AI call, no Notion write) → a confirmation step asking what Claude couldn't see (channel, start date/year, kind, call time, company: `renderer/lead-confirm.js`) → `--reading` + `--channel/--started/…` writes it; Telegram logs unconfirmed and says "⚠️ Check: …"; `added.py` jobs added by hand or from a message/email get stage 1 facts and the stage 2 fit score on their Applications row (fit columns; no Job Matches row), before the record is frozen; LinkedIn/Glassdoor/Indeed pages are never fetched (`ledger.NO_FETCH`), the title/company/text come from the user), `src/notion/` (`client.py` Notion API, `matches.py` Job Matches sync, `ledger.py` application record frozen at Applied + 📈 Application Events outcome history + scheduled sync/no-response rule, `funnel.py` funnel conversion + step to improve → 🎯 Pipeline page, no AI).
- `config/` holds editable settings: `preferences.json`, `sources.json` and `scout_seeds.json` (empty since 6 Oct 2026: a user's own additions only). Every starting source is central: `job-pilotto-internal/config/starter_sources.json` and its `scout_seeds.json`, published by the central scout in the employer index with places and role mix; an install ignores copies of the old shipped lists (`src/legacy_lists.py`).
- `desktop/lib/interviews.js` + the app's Interviews page: records (mic left, call's audio right), keeps only drafts and recordings on the Mac, saves/lists/relinks/reviews rows in Notion 🎤 Interviews. Recording needs the consent box ticked each time.
- **Product vs personal.** Product (shared, the owner's Cloudflare account, subdomain `jobpilotto`): one worker `www` from `site/` → https://www.jobpilotto.top — website, Pro waitlist (KV), Notion sign-in, and the app's form reports (`/report/fill-failure`, reusing `worker/src/report.js`; secrets `GITHUB_TOKEN`, `REPORT_TOKEN`). Personal (per user, set up in the desktop app): their Telegram bot and their scheduled runs (their private GitHub repo). Nothing in the code is tied to one Telegram bot.
- `worker/` is the Telegram bot's code (commands and buttons): the app runs it locally with long polling (`desktop/lib/telegram.js`); as a Cloudflare worker it's a per-user deployment for buttons while the computer is off: `desktop/lib/telegram-cloud.js` uploads `desktop/shared/bot-worker.js` (esbuild bundle from `scripts/stage.mjs`) as `job-pilotto-bot` to the user's own Cloudflare account with their token (Settings → Always on → Telegram buttons, always on), sets the webhook, and the app stops long polling (`settings.telegramCloud`). Not deployed by the owner; `npm test`.
- Workflows: `.github/workflows/daily.yml`, `scout.yml`, `mail.yml` are the engine: reusable (`workflow_call`) and manual, with no schedule, so this public repo never runs on anyone's data. The schedules (daily every 4 h, scout daily, mail 3x a day and 5 min after applying) live in each user's private repo, from `templates/github-actions/` (the owner's: `GarryOne/job-pilotto-private`).
- `desktop/lib/github.js`: the app's **Always on** (runs on GitHub, even when the Mac is off), as a GitHub App installed on one repo only: the user creates `<user>/job-pilotto-private` from the public template `GarryOne/job-pilotto-starter` (published from `templates/github-actions` by `tools/publish-starter.sh`), installs the app on it, approves a device-flow code; the app then commits the templates + the user's `config/search.json`/`preferences.json` (overlaid on the defaults by the engine), sets sealed secrets and variables; while on, Telegram buttons dispatch there and the Jobs list comes from the latest `job-pilotto-jobs-db` artifact.
- Apply with Claude (Desktop App job row's ⋯ menu when Claude Code is installed and Notion connected; the main button is plain Apply, the extension filling a normal Chrome tab, since 1 Oct 2026): `desktop/lib/apply.js` `claudeOne` → `desktop/lib/claude-session.js` (Mac: Terminal; Windows: a console window via `start`, needs Git for Windows), one `claude --chrome --permission-mode bypassPermissions` session per job, started in the app's pipeline folder with the skill bundled (`stage.mjs` copies `.claude/skills/apply-to-job`), after a one-time consent (`settings.claudeConsent`, asked at the first press on the stuck page or card); it follows job board → employer site → sign-up → form ("Reaching the form" in the apply-to-job skill). Employer passwords go through `python3 -m src.ai.passwords` into the Keychain / Windows Credential Manager (`job-pilotto.<host>.password`); the session's `python3` is a shim to the app's Python; confirmation emails are read with `python -m src.sources.google verify` (Gmail read-only, connected in Settings → Gmail and Calendar). Never Submit.
- Form-filling improvement loop: every extension fill is logged to Agent Runs (field table + debug JSON); `tools/fill-failures.py` groups what was left; the **improve-filling** skill (`.claude/skills/improve-filling/SKILL.md`) turns the top failures into tested fixes. Data gaps go to the app's "Answer once" list.
  Recurring problems and fill failures are triaged in the private repo (`job-pilotto-internal`, `triage.yml`); there is no automatic code fixing: fill failures are fixed by recipes (the proposer and the canary; the form lab was retired 9 Oct 2026), other fixes by hand or PR.
- Notion IDs have no defaults in code: they come from the environment (`.env`, repository variables, or the Desktop App).
- **The terminal follows the Desktop App** (`src/paths.py` `follow_app`): when the app is set up on this computer,
  terminal runs use its Notion IDs and its `data/` + `config/` folders (one job cache); a line on stderr says so.
  `.env` NOTION_* IDs of another workspace (e.g. the test one) switch that off for the run, never mixed.
  `JOB_PILOTTO_FOLLOW_APP=0` turns it off. Searches from the app and the terminal take turns (`run_lock`).

## Debugging a failing e2e step (6 Oct 2026: one step cost ~1 h and 10 full-suite runs of 2-4 min)
- **Read before you re-run.** Open the failure's artifacts first (`suite-failures.json`, screenshot, `logs/app.log`). A failure that only says `""` or "not found" is
  missing evidence: add the capture or log line that would have answered it (the app's state, ids, errors), don't guess with probes.
- **Reproduce small, in seconds, then confirm once.** Seed the state: `npm run shot -- <page> --js "<click>" --eval "<state>"` on `desktop/demo/` fixtures (a Notion page
  read in demo mode comes from `demo/run-pages.json`), or a unit test. Run the e2e step once at the end: `E2E_STEPS="<step>,<prerequisites>" node run-all.mjs --only <suite>`.
  Never loop the full suite to see what a step sees.
- **Prove the repro before you say "reproduced" or "never called".** Check its own setup took effect (the stub was called, the seed is in the state, the control you
  clicked is visible). `window.pilot` is a read-only contextBridge: assigning to it silently does nothing, so a stub there tests nothing. And a step run on its own
  (`E2E_STEPS`) lacks what the skipped steps built (one run hides the Recent activity filter): list what you removed before trusting a pass or a fail.
- **Other sessions share the suite's Notion token.** Check `logs/notion-requests.log` for 429s and `runs` you did not start before blaming the app: the app's Notion calls queue (~340 ms apart, 25 s+ right after a start), so a read can be slow, not broken.
- **Nothing is swallowed silently.** A `.catch(() => …)` in the app or a test helper logs what it caught (`appLog` area `run`, or a console error the step collects).
- **A failing step saves the app's state before it closes anything** (selected run, ids, panel text, page errors), not a screenshot of the page after it closed.

## Tests
`python3 -m unittest discover -s tests`, `cd worker && npm test` and `cd desktop && npm test`.
A Claude Code hook (`.claude/settings.json` → `tools/pre-push-check.sh`) runs the suites of the areas the push touches (`PUSH_FULL=1`: all; AGENTS.md "Change tiers"), plus the
Python suite without credentials as CI sees it, before every `git push` and blocks the push if one
fails, so only green builds reach GitHub. It also lints the workflow files (`actionlint`, with
shellcheck on each `run:` script) and, when a `package.json` or lock file changed, proves `npm ci`
works from scratch, the two CI-only failure classes the tests can't see. Two more guards: `build.yml` must
install dev dependencies like a developer does (an `--omit=dev` there once hid a missing esbuild from this hook
and left 8 commits red), and a push is blocked while the latest `build` run on main is red: the first session to see
it fixes it forward or reverts it, pushed with `CI_RED_OK=1 git push ...` (AGENTS.md "Red main"). The suites run on a
clean checkout of what is pushed, one area at a time like CI, so leftovers in your folder can't hide a break.
A Stop hook (`tools/stop-test-check.sh`) runs the suites your changes vs origin/main touch, as CI does, before you say done.
