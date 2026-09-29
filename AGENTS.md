# Job Pilotto — instructions for any agent (Claude, Codex, or other)

This repo's own files are the canonical source of truth for this project. If you're an agent
reading this because a session is rooted in this folder, don't keep separate notes elsewhere that
duplicate what's here — read these instead, and update them if something's missing or wrong:

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
- Notion is required in the Desktop App (decided 28 Sep 2026): the setup can't finish without it, and a
  set-up app without a Notion connection opens the Notion step. There is no Mac-only mode.
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
- Never force-push `main`, and never use a bare `git stash`/`stash pop`: the stash stack is shared
  across worktrees and sessions.
- Read-only work and Notion-only updates don't need a worktree.

## Desktop UI
Before building or changing a screen in `desktop/renderer`, read `.claude/skills/ui-look-and-feel/SKILL.md` (patterns, reference
screenshots in `desktop/docs/ui/`, and how to render the change in demo mode to check it).
