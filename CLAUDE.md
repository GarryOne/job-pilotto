# Job Pilotto — notes for Claude

Personal job-search automation: crawls job boards and employer feeds, filters and scores jobs with Claude, sends a Telegram digest, tracks
applications (SQLite or Notion, behind one store interface).

This file holds the rules every session needs, one line each. Detail is in `docs/rules/` (read the one your task touches); the incident behind each
rule is in [docs/rules/why.md](docs/rules/why.md): read it before relaxing a rule.

## Start here
1. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** once per session; **[docs/HOW-IT-RUNS.md](docs/HOW-IT-RUNS.md)** only when the task touches an
   automatic loop (trigger, what it may change, where the owner approves).
2. The skill for your task (listed by Claude Code), and the `## Progress` checklist of the spec you work on (`/report-progress`).
   No Notion page is read at start (owner, 11 Oct 2026). Any Notion ID, when a task needs one: skill **notion-map**.
3. **Code: `node desktop/scripts/codemap.mjs <words>`** (every file → its purpose, live from each file's first comment), then open only that file.
4. Rules for any agent: [AGENTS.md](AGENTS.md) (git, worktrees, change tiers, which test, red main, commits). Humans too: [CONTRIBUTING.md](CONTRIBUTING.md), [RELEASE.md](RELEASE.md).
5. New file: start it with a one-line comment (docstring in Python) saying what it's for (at least 25 characters): the code map reads it.

## Safety rules (never relaxed without the owner)
- **Never Submit an application, never auto-apply.** The kit drafts, the owner submits. No captcha, bot check or SMS code; never past a login wall
  (LinkedIn, Glassdoor, Indeed, levels.fyi, Reddit: only through the user's own visit; 401/403/429 is a no).
- **Tests and automation never touch the owner's live app, accounts or real data.** List what product code reaches (ports, Keychain, tokens, real
  profile/CV, paid APIs), cut it off and assert it; always through the harness (`desktop/e2e/lib/extension.mjs`, `real-extension.mjs`); real sites
  only with fake applicant data. The one exception is the twin ([docs/live-test.md](docs/live-test.md)): never the owner's window, never Submit, never a password field.
- **Secrets only in the macOS Keychain** (`job-pilotto.*`), GitHub secrets and Cloudflare Worker secrets; never in code, docs or Notion.
- **Claim the flow core before editing** `FLOW_CORE` / `FLOW_FILES` (`desktop/e2e/flows.mjs`): message every peer, read the file's "Invariants:"
  block, say "released" when done ([docs/rules/applying.md](docs/rules/applying.md)).
- **Meaning comes from AI, never from keyword lists:** emails, pages, buttons and questions come in any language. Fetch by structure, let AI decide with a fixed
  answer the code validates (`src/ai/decide.py`, `meanings.py`); a word list is at most a free shortcut in front of the AI or a safety floor.
  **Judgments about a page are the AI's** (ready? did it work? bot check? which step?); structure only finds controls, floors only AND with the AI.
- **Universal first: fix a shape, not a site.** No site names, hosts, vendor lists or growing regex; a form bug improves the self-improving mechanism (operator,
  fingerprint, alias meaning, recipe, noticing the miss) and is tested on a fixture shape. Guard: `tools/hardcoded-page-words.mjs`.
- **Ask before spending money on AI** (a new model or large re-runs); show the measured cost.

## Working rules
- **Every fix works for any user, through the Desktop App:** a step done by hand (terminal, Keychain, `gh secret set`, a Notion edit) is a product
  bug: build it into the app and test it.
- **Wrong data is a bug:** fix the root cause with a regression test, then repair the owner's rows by hand via the Notion MCP. No one-off repair code.
- **Data has one copy, behind the store interface** (`src/stores/`, SQLite default, Notion by choice; new data goes through every adapter). The
  employer index is product data, never in a user's store. Detail: [docs/rules/data-ownership.md](docs/rules/data-ownership.md).
- **The extension first, Claude as the safety net:** Claude finishes a stuck page on the person's press or a visible 5-second countdown, at most once
  per application. Detail: [docs/rules/applying.md](docs/rules/applying.md).
- **Files: one concern each, ≤ 500 lines; split near 450** as a pure move. Detail: [docs/rules/files.md](docs/rules/files.md).
- **Screens:** reuse cards, components and tokens; every new screen or action goes in the ⌘K palette. Detail: [docs/rules/desktop-ui.md](docs/rules/desktop-ui.md),
  skill **ui-look-and-feel**; `desktop/` changes: skill **desktop-change**.
- **Every lesson lands in its strongest form** (a failing test, a gate, a skill step, memory, a spec checklist; a note is the weakest).
  Before saying done: what did this teach, and where does it live? Detail: [docs/rules/knowledge.md](docs/rules/knowledge.md).
- **No subagents** unless the owner asks: work inline. **One issue per session**; new splittable work goes to a hand-off.

## The change loop
1. **Worktree:** `tools/worktree.sh <topic>`. Worktrees are **kept** after landing (owner, 11 Oct 2026); `tools/worktree.sh prune` (dry run;
   `--yes` acts) removes ones fully on main and untouched for 7 days. Never remove another session's worktree.
2. **Say the tier** (AGENTS.md "Change tiers") and **the test method** (AGENTS.md "Which test for which question"); stop when the tier is met.
   - Tier 0 (copy, CSS, small fix): the touched tests, no screenshot.
   - Tier 1 (feature, screen): + one targeted `npm run shot`.
   - Tier 2 (money, store writes, apply flow, installer, engine, migrations): the area's e2e suite, `tools/ship.sh --full`.
3. **Tests first** for new behaviour and for any bug the owner saw (watch it fail). A behaviour change updates the e2e step it breaks in the same commit.
4. **Land:** `tools/ship.sh` (rebase, the touched suites, push with retry). Commit subject ≤ 72 characters, imperative, no reasons in it.
   Never a CI e2e run by hand ([docs/rules/change-loop.md](docs/rules/change-loop.md)).
5. **After landing, only what applies:**
   - The history is the commit messages (the Notion Run Log and Session Handoff were retired on 11 Oct 2026).
   - **Decision Log** (Notion): a row only for an owner decision that changes what agents may do; read it on demand, never at start.
   - **Bug Tracker** (Notion, read by the UI Finder in CI): a row only for a UI bug a person found that the Finder missed.
   - **Technical Reference** is the owner's design page, not agent input: a big feature's spec checklist may include updating it.
   - **Intelligence page** (`site/public/intelligence.html`, its teaser, the README "AI at every step"): only when a user-visible AI step changes.
   - The to-do list: after a finished task, not per commit.
6. **Big changes** (a feature, migration, refactor): spec with a `## Progress` checklist, safety net first, ONE full run at landing, 1-3 commits
   ([docs/rules/change-loop.md](docs/rules/change-loop.md)).
7. Weekly self-review (`.github/workflows/weekly-self-review.yml`) proposes rule edits as a PR; the owner merges.

## Where the detail is
| Topic | File |
|---|---|
| Data, stores, Notion adapter, runs, employer index | [docs/rules/data-ownership.md](docs/rules/data-ownership.md) |
| Extension, Claude takeover, assistant mode, flows, flow core, ladder, live tests | [docs/rules/applying.md](docs/rules/applying.md) |
| Screens, tokens, components, ⌘K palette, screenshots | [docs/rules/desktop-ui.md](docs/rules/desktop-ui.md) |
| File size, splitting safely | [docs/rules/files.md](docs/rules/files.md) |
| Habits, big changes, e2e steps, debugging e2e | [docs/rules/change-loop.md](docs/rules/change-loop.md) |
| Facts easy to get wrong, code layout | [docs/rules/facts-and-layout.md](docs/rules/facts-and-layout.md) |
| How knowledge is kept between sessions | [docs/rules/knowledge.md](docs/rules/knowledge.md) |
| Running a fix round (coordinator): order, target, no tooling mid-round | [docs/rules/rounds.md](docs/rules/rounds.md) |
| Why each rule exists | [docs/rules/why.md](docs/rules/why.md) |

## Tests
`python3 -m unittest discover -s tests`, `cd worker && npm test`, `cd desktop && npm test` (`tools/check.sh` runs them as CI does).
- The pre-push hook (`.claude/settings.json` → `tools/pre-push-check.sh`) runs the suites of the areas the push touches on a clean checkout
  (`PUSH_FULL=1`: all), lints workflows, proves `npm ci` when a lock file changed, and blocks a push on a red main (AGENTS.md "Red main").
- The Stop hook (`tools/stop-test-check.sh`) runs the suites your changes touch before you say done.
- The gate reuses a suite pass on identical inputs (`tools/gate-cache.sh`; `GATE_CACHE=0` off, `PUSH_FULL=1` re-runs); a fail is never cached.
  Each step's time is logged (`<git common dir>/gate-timing.log`, `GATE_TIMING=0` off).
- Areas with no affected test are not started (`JOB_PILOTTO_TIERS=0` starts all); browser suites and replays take one machine-wide lock
  (`tools/heavy-lock.sh`, the primary checkout's copy, first come first served, a 2nd run only with spare memory, waits on a busy Mac, `JOB_PILOTTO_HEAVY=0` skips); `tools/ship.sh` lands without a queue (a refused push rebases and re-runs
  the checks), takes the extension version + fingerprint after each rebase (never bump it by hand to land), and keeps the worktree.
