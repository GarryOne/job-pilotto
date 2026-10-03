# Job Pilotto — instructions for any agent (Claude, Codex, or other)

This repo's own files are the canonical source of truth for this project. If you're an agent
reading this because a session is rooted in this folder, don't keep separate notes elsewhere that
duplicate what's here — read these instead, and update them if something's missing or wrong:

- **`docs/ARCHITECTURE.md`** — the session-start map (engine, app, extension, website, bot, Notion).
  Read it once at the start of a session, then `CODEMAP.md` for the file. Written for every agent:
  Grok, Claude Code, Codex, DeepSeek.
- **`CLAUDE.md`** — project overview, working rules (never auto-apply, ask before AI spend,
  secrets policy), code layout, how to run tests. Written for Claude Code but applies to any agent.
- **notion-map** skill (private, `~/.claude/skills/notion-map` on the owner's Mac) — every Notion page/database ID this project uses, and
  which one answers which kind of question. Read this instead of searching Notion from scratch.
- **`.claude/skills/apply-to-job/SKILL.md`** — how to fill a job application form from an
  application kit (per-platform findings, the fast-path technique, the leak guard, the full
  automatic flow via `tools/apply-batch-chatgpt.sh`). Read this before filling any job form for this
  project, whether invoked by a person or by another agent.

## If you're Codex, or another agent with your own global instructions/skills/memory

Point your own global config at these files rather than keeping a second copy:
- Don't maintain a separate Notion-structure skill — use the notion-map skill.
- Don't maintain separate job-application-filling instructions — use
  `.claude/skills/apply-to-job/SKILL.md`; update its Log and Platform notes sections with what you
  learn, the same way this project already does.
- A personal-profile cache with real contact details (email, phone, address) may live in your own
  local state if that's how you work — **never write it into this repo or any file under
  `.claude/`**. The canonical profile is the Notion **Profile — CV and Preferences** and
  **Application Answers — Standard Form Fields** pages (see notion-map for their IDs); treat a
  local cache of them as exactly that, a cache, not a second source of truth.

## Golden rule for filling any form: a handful of tool calls, not dozens

A form we have already seen should never be filled one field at a time with a screenshot per
field. The flow, for every agent and every tool:

1. **Map once.** One page evaluation lists every field (id, type, label, required, filled) —
   `window.__jobPilottoAuditVisibleFields()`.
2. **Build the plan before filling.** Decide every field → value up front from the kit, the
   Profile and Application Answers (Profile's confirmed answers beat the kit's guesses). No
   deciding values mid-form.
3. **One fill call.** Inject `tools/browser-submit-guard.js` then `tools/browser-form-fastpath.js`
   (Playwright init script, or the file's text passed to the page's JS tool), then fill every
   plain field in one evaluation with `window.__jobPilottoFillKnownFields(plan)`. Fields it skips
   (Greenhouse dropdowns are react-select comboboxes): open, read live option coordinates with
   `window.__jobPilottoOptionPositions()`, click — no screenshot per field.
4. **Verify once** with the audit.
5. **Upload the résumé** (last — Greenhouse can reset other fields after an upload).
6. **Re-verify once**, then hand over. Never Submit.

**Keep evolving `tools/browser-form-fastpath.js`.** Whenever a step was done by hand that could
be deterministic, add it there (commit it, and note it in the apply-to-job skill's Log), so the
next run is faster. Its limits stay: no submit, no legal/consent fields, no checkbox clicks, and
it returns field ids and status only, never applicant values. If a session's tool-permission check
blocks an action, don't build that action into this helper to get past the check — the owner
decides that through their own permission settings.

## Hard rules (same as CLAUDE.md, repeated because this file may be read on its own)

- Never click Submit on a job application. Ever. The owner reviews and submits every application
  themselves, in every tool.
- Legal-acknowledgment checkboxes ("I agree to...", privacy notices) are always left for the owner
  to check, even when an answer is supplied for them.
- Never invent experience, numbers, employers, or credentials. Only facts from the Profile,
  Application Answers, the CV, and the posting.
- Ask before spending money on AI models or large re-runs; this project already has three tiers
  running (Haiku extraction, Sonnet scoring, Sonnet kit drafting) — a fourth or a big re-run needs
  the owner's sign-off first.

## Data ownership: Notion is the source of truth (one copy of everything)
Data is Notion-first. Before adding any stored field, file, setting or table, decide where it lives:
- **Notion** — anything the user reads, edits, or would want on another device: statuses, run results,
  profile/answers, open questions, contact details, learned form notes, search settings, transcripts.
  The code reads it from Notion; it never keeps a second editable copy.
- **The Mac / runner** — only keys (encrypted), large files (CVs, recordings) and caches that can be
  deleted and rebuilt from Notion or a crawl (`jobs.sqlite`, `config/*.json` as the cache of ⚙️ Search
  settings, `runs.json`). A cache is refreshed *from* Notion; writes go to Notion first, and if Notion
  refuses, nothing changes locally and the user is told.
- Notion is required to **track**, not at setup ("Notion later", decided 3 Oct 2026, replacing "required at setup" of
  28 Sep): the setup finishes without it and the app is then only **trying**: search, fit scores, the Jobs list and
  Strategy. Every tracking action (save, dismiss, kit, apply, applied elsewhere, add job, leads, interviews, Focus,
  Gmail, Telegram, Always on) answers `notionGate.needs(reason)` (`desktop/lib/notion-gate.js`) and the window opens the
  connect prompt (`renderer/pages/notion-connect.js`; `preload.cjs` turns any such answer into that prompt and retries the
  action after a connect). The only user data on the Mac while trying is `profile.md`, `answers.md` and the search config
  cache; `lib/migrate.js` 'strategy from this Mac' moves them into Notion at connect (a new workspace takes this Mac's;
  an existing one wins) and deletes them. No other local copies: a feature that stores user data goes behind the gate.
  Always on never moves data (it changes where runs happen, not where data lives). Spec: `docs/superpowers/specs/2026-10-03-notion-later.md`.
- No new "local fallback" copies of user data. A feature that needs a new database, column or page adds it
  to Notion *and* to `config/notion_schema.json` (`tools/notion_schema.py snapshot`), so every workspace can
  be rebuilt and repaired (`desktop/lib/schema.js`).
- Moving existing local data to Notion: add a step to `desktop/lib/migrate.js` (delete the local copy only
  after Notion confirmed it has it) and a test.
- Every run (search, Gmail check, kit, review) leaves a row in ⏱️ Search runs with its details, whatever
  started it, so users see what happened in Notion without the app having to show it.

## Working with git: one worktree per task

Several agents (Claude, Codex, …) work on this repo at the same time, all pushing to `main`. To keep
them from colliding in one checkout:

- Make every code change in its own git worktree on its own branch, never directly in the main
  checkout: `tools/worktree.sh <topic>` (a worktree in `.claude/worktrees/<topic>` from `origin/main`, with the main
  checkout's `node_modules` linked in, so the tests run at once; `node_modules` is git-ignored: leave the links alone).
- Commit there. Before landing: `git fetch && git rebase origin/main`, run both test suites
  (`python3 -m unittest discover -s tests`, `cd worker && npm test`), then
  `git push origin <topic>:main` (fast-forward only; if it's rejected, fetch, rebase and test again).
- Remove the worktree afterwards: `tools/worktree.sh --done <topic>`.
- Never force-push `main` — not `--force`, not `--force-with-lease`. Several agents push here in
  parallel, and a force-push deletes every commit that landed since your last fetch, silently. This
  happened on 1 Oct 2026: a `--force-with-lease` during a rebase dropped `8dce9ba` ("Windows update:
  install after the app has quit…"), which another session had pushed minutes earlier.
  `--force-with-lease` does not protect you: it only checks the remote is where *you* last saw it. If
  a push is rejected as non-fast-forward, the remote moved — fetch, rebase again, keep **both** sides'
  work in any conflict, run the tests, and push normally. Fixing an already-pushed commit means a
  second commit, not an amend. If you do clobber one, recover it from the reflog in the same turn
  (`git reflog` → the old `origin/main` tip → `git rebase <sha>` → normal push) and say what happened.
- Never use a bare `git stash`/`stash pop`: the stash stack is shared across worktrees and sessions.
- Read-only work and Notion-only updates don't need a worktree.

### Commit messages
- **Commit subject: one line, at most 72 characters** (GitHub cuts the list at about that, 2 Oct 2026: subjects of 150+ characters
  with version numbers and reasons made the history unreadable). Imperative, what changed: `Extension: drop "Use on this tab"`.
  No version number, no reasons, no "because…" in the subject; those go in the body (blank line, then wrapped text).
  The pre-push hook blocks a push with a longer subject: `git commit --amend` / `git rebase -i` your own unpushed commits
  (never a pushed one). Attribution lines stay at the end of the body.

## If you're not Claude Code (Codex, Grok, the DeepSeek Harness, anything else)

Everything above applies. Only the *automatic* checks are Claude Code's: `.claude/settings.json` hooks
(`tools/pre-push-check.sh` before a Bash call, `tools/stop-test-check.sh` at the end of a turn) — they are not git
hooks, so no other agent gets them (`.git/hooks/` holds only samples, `core.hooksPath` is unset). **Run them yourself,
then say what passed** (learned 30 Sep 2026, each of these cost real time):

```sh
JOB_PILOTTO_DISABLE=mail,notion,telegram,google_jobs python3 -m unittest discover -s tests
cd worker && npm test
cd desktop && npm test
```

- **`desktop/npm test` needs its `pretest`** (`scripts/stage.mjs`): in a fresh worktree, without staging, seven files
  fail on a missing `desktop/shared/` and look like real regressions.
- **A read-only `<repo>/data`** makes the Python suite error on `data/insights.lock` (14 tests): pass
  `JOB_PILOTTO_DATA_DIR=<a writable folder>`. The DSH sandbox starts that way for this repo, since the session
  workspace is elsewhere; the first write needs the user to widen the policy, after which the rules above apply as they
  are.
- **Adding a file?** `node desktop/scripts/codemap.mjs`, or the freshness test fails.
- **The smoke hooks** (`desktop/main.js`): `JOB_PILOTTO_SMOKE_JS` must be an IIFE — top-level `await` hangs the window —
  `JOB_PILOTTO_SMOKE_EVAL`'s result is written to `<JOB_PILOTTO_SMOKE>.json`, and `..._SELECTOR` crops the picture.
- **Notion, if your harness has no tool for it**: the change loop above expects the hub, Run Log, Technical Reference
  and Handoff to be updated. Say plainly that it wasn't done rather than implying it was; the HTTP API is reachable with
  the Keychain token (`job-pilotto.notion.token`) and `gh` is authenticated, so reads and repairs are possible when
  asked.

### If your host is an Electron app (the DeepSeek Harness, Claude Code inside VS Code or Cursor, any other Electron host)

`ELECTRON_RUN_AS_NODE=1` is inherited from the host process — it is in no shell profile — and it makes Electron load
`main.js` as plain Node, so any render, `npm run shot` or `npm run ui-shots` dies with *"does not provide an export named
'BrowserWindow'"*. Check with `env | grep ELECTRON_RUN_AS_NODE` and prefix the command:

```sh
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

### When "no open Chrome tab matches this job" is a lie (macOS, 1 Oct 2026)

macOS keeps **one** Apple Event connection per application, and it goes to whichever "Google Chrome" registered
first. An automation that leaves a windowless Chrome behind (`--no-startup-window`/`--headless`, launched from
`~/.claude/jobs/<id>/tmp/` or a temp dir) therefore **owns** Chrome's scripting: `windows()` answers `[]`, so the
app's focus/reload/close see no tabs at all and the session page says the form's tab is missing while the user is
looking straight at it. It cost hours to find once.

```sh
lsappinfo list | grep -A1 '"Google Chrome" ASN'      # two entries: BackgroundOnly (the stray) and Foreground (yours)
ps -Ao pid,ppid,lstart,command | grep 'MacOS/Google Chrome '   # the stray has ppid 1 (its launcher is gone)
```

The app now detects this (`desktop/lib/background-chrome.js`) and offers to quit the orphan from the extension card,
and the extension's own tab report is used for "which forms are open" so scripting is no longer the only source. When
you launch Chrome yourself in a script, kill it on exit (`trap 'kill $!' EXIT`), or it will hijack the next run.

## Desktop UI
Before building or changing a screen in `desktop/renderer`, read `.claude/skills/ui-look-and-feel/SKILL.md` (patterns, reference
screenshots in `desktop/docs/ui/`, and how to render the change in demo mode to check it).

## Logging: when a debug session makes you wish for a line, add it then and there (1 Oct 2026)
Debugging that had to lean on file mtimes, Notion timestamps and GitHub runs — because nothing was written
down — is the signal to add logging, not to move on. Add it in the same turn, permanently.

- **Log decisions, not just errors.** Every irreversible or money-spending action (a Notion stage write, a cloud
  dispatch, an "Applied", a form fill, a run's start and end) gets one line: what happened, what asked for it, and
  the evidence it rested on. "Who decided this, and why?" must be answerable from the logs alone.
- **Log the evidence's identity, never its content.** Field names, counts, source, a short digest of the inputs,
  ids. Never the user's words, form answers, message bodies or tokens (`lib/log.js` says exactly this at the top).
- **The right file.** `logs/app.log` — the app's own doings, `log(area, message, fields)` from `lib/log.js`;
  `logs/engine.log` — what the Python engine printed for a run; `logs/notion-requests.log` — API traffic.
- **Read the logs first.** When something is wrong, `grep <area> logs/app.log` before archaeology. If the answer
  wasn't there, adding that line is part of fixing the bug.
- **Areas are stable and searchable** (`dispatch`, `sessions`, `run`, `extension`, `prep`, `review`, `update`,
  `window`): a new one is fine, a renamed one is a small tax on every future grep.

## JavaScript lint checks
Desktop `npm test` runs ESLint first across `desktop/` and `extension/` (including tests and scripts). `no-undef` blocks failures; `no-unused-vars` is advisory. Use `cd desktop && npm run lint` for fast feedback. Fix the cause of lint errors; do not silence them by inventing globals. Browser, Node, preload and Chrome-extension globals are configured in `eslint.config.mjs`; generated build and shared files are excluded.

## Shared verification and checked desktop boundaries
Use `tools/check.sh --fast` while editing, `tools/check.sh --area desktop` (or python/worker/site) for a full area suite, and `tools/check.sh --clean-install` before landing. The command selects Python 3.12+ and supported Node, stages desktop shared files, and reports setup problems without installing packages. CI and Claude hooks delegate to this same runner; it works from any directory and any agent.

Electron lifecycle callbacks are in `desktop/lib/lifecycle.js` with injected services; import them directly in tests. `main.js` supplies startup initialization and current app services. Session IPC channels must register through `sessionIpc` in `desktop/lib/session-contracts.js`; every exposed session channel has argument and response checks. Public terminal session views use that same contract. Add a channel's contract and tests before exposing it. Contracts cover the session bridge, not every IPC action yet. Contract failures log channel/direction/field names only, never argument values or session content.

## Offline app scenario tests
`tools/check.sh --fast` and the full desktop suite run `desktop/test/app-scenarios.test.js`.
Use `cd desktop && npm run test:scenarios` to reproduce just these journeys (stages shared files first).
When changing startup/reconciliation, session questions, resume, cancel, review handoff or quit, extend a
journey with the user's actions and observable consequences, including after restart and on service failure.
The suite runs the real preload, `lib/session-handlers.js` registrations, launcher, terminal persistence,
lifecycle callbacks and renderer state/cache helpers. Inject fake terminals, browser/dialog replies and Notion
responses; use fictional data in temporary folders, never real keys, applications, AI calls or browser tabs.
`main.js` supplies the live services to `registerSessionHandlers`; keep behavior there rather than duplicating
handlers in a test. These are offline integration tests, not a graphical Electron/Chrome end-to-end test.
Render changed screens with the normal demo smoke tools; live service compatibility needs separate checks.
