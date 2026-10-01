# Contributing to Job Pilotto

> **In short:** one worktree per change → find the file in `CODEMAP.md` → change it → tests → push to `main`.
> Rules that are never bent are at the bottom. Releases: [RELEASE.md](RELEASE.md).

## 1 · Set up (once)

| What | Command |
|---|---|
| Python pipeline | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| Desktop app | `cd desktop && npm install && npm start` |
| Telegram bot · website | `cd worker && npm install` · `cd site && npm install` |
| Check your setup | `python3 -m src doctor` |

Your own keys live in the macOS Keychain (`job-pilotto.*`), never in files you commit.

## 2 · Make a change

1. **Worktree:** `tools/worktree.sh <topic>` → `.claude/worktrees/<topic>`, branch `<topic>`, packages already linked.
   Several people and agents push to `main` at once: never edit the main checkout, never bare `git stash`.
2. **Find the file:** read [`CODEMAP.md`](CODEMAP.md) (every file → what it's for), open only that file.
3. **Change it**, with a test for anything that can break again (`tests/` for Python, `desktop/test/` for the app).
4. **Check it:** every AI tool and CI use the same runner, which selects supported Python and Node runtimes:

   - `tools/check.sh --fast` — desktop lint, staging, lifecycle, app scenarios and session contract tests.
   - `tools/check.sh --area desktop` (or `python`, `worker`, `site`) — a complete suite; repeat `--area` to select several.
   - `tools/check.sh` — all four suites, external Python services disabled as in CI.
   - `tools/check.sh --clean-install` — also prove dependency lockfiles install in temporary folders before landing.
   - Missing dependencies are reported, never silently installed; `tools/worktree.sh` links the existing packages.

   Direct suite commands remain available:


   | Area | Command |
   |---|---|
   | Python | `python3 -m unittest discover -s tests` |
   | Desktop | `cd desktop && npm test` |
   | A screen | `cd desktop && npm run shot -- <page> [--select '<css>'] [--eval "…"]` → look at the PNG |
   | Bot · site | `cd worker && npm test` · `cd site && npm test` |

5. **Land it:** `git fetch && git rebase origin/main`, test again, `git push origin HEAD:main`.
   A hook (`tools/pre-push-check.sh`) runs every suite and lints the workflows first, and blocks a red push.
6. **Clean up:** `tools/worktree.sh --done <topic>`.

<details><summary>Commit messages</summary>

- One line saying what changed for the user, then details if needed.
- AI agents add their `Co-Authored-By:` trailer.
</details>

## 3 · Where things go

| You add… | It goes… |
|---|---|
| Anything a user reads or edits (statuses, answers, run results) | **Notion** (the source of truth), plus its column in `config/notion_schema.json` |
| A column the code stops writing | the database's `retired` list in the schema: every workspace drops it at the next app start |
| A key or token | Keychain / GitHub secrets / Cloudflare secrets: never code, docs or Notion |
| A cache | the Mac (`jobs.sqlite`, `runs.json`…): always rebuildable from Notion or a crawl |
| A colour, size, radius, font | `desktop/renderer/tokens.css` only (`design.test.js` fails otherwise) |
| A UI building block | `desktop/renderer/components.js` + `components.css` (and `gallery.js`) |
| A new file | a first-line comment saying what it's for; `node desktop/scripts/codemap.mjs` updates the map |
| A run of any job | a row in ⏰ Cronjob Runs (`src/notion/cron_runs.py`): start → end, result, log |

## 4 · Before you say it's done

- [ ] Tests pass, and a test covers the bug you fixed.
- [ ] A changed screen was rendered and looked at (skill `ui-look-and-feel`).
- [ ] Anything you fixed **by hand** (a command, a Notion edit, a secret) is now done **by the app** for every user.
- [ ] You said what changed, the commit, and whether it needs **⌘R** (window only) or a **restart** (main process, lib/, preload, Python).

<details><summary>Traps that caused real bugs</summary>

See the skill **desktop-change** (`.claude/skills/desktop-change/SKILL.md`): restart vs ⌘R, state shown in several places,
async results cached empty, AI answers cut off by `max_tokens`, runs that don't report back, `#id` CSS beating a class,
`@media` vs `@container`, and more. Add a line there whenever a bug surprises you.
</details>

## 5 · Rules never bent

- 🚫 **Never auto-apply to a job:** Job Pilotto drafts and fills; the user submits.
- 🚫 **Never scrape LinkedIn, Glassdoor, levels.fyi or Reddit:** public APIs and job feeds only.
- 💸 **Ask before spending money on AI** (a new model, a large re-run); show the measured cost.
- 🔐 **No secrets** in code, commits, docs or Notion.
- 🧑‍💻 **Every setup step works for any user through the app:** nothing may depend on the owner's machine.

## 6 · License of your contribution

Job Pilotto is source-available under [FSL-1.1-ALv2](LICENSE.md). By opening a pull request you agree that your
contribution is licensed under the same terms, and that the maintainer may also license it under later versions of
Job Pilotto's license (including the Apache 2.0 future license). Welcome contributions: job feeds, support for more
application systems, form-filling fixes, translations.

Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems: [SECURITY.md](SECURITY.md) (report privately).

More: [CLAUDE.md](CLAUDE.md) (project rules and data ownership), [AGENTS.md](AGENTS.md) (agents, form filling),
[README.md](README.md) (what the product does).

For session workflow changes, extend `desktop/test/app-scenarios.test.js`: real preload and handlers, fictional terminal/service responses, temporary persistence, and checks after restart. Run `cd desktop && npm run test:scenarios` for that suite alone. It runs in normal desktop CI and `tools/check.sh --fast`; graphical and live-service smoke checks remain separate.
