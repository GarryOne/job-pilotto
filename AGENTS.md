# Job Pilotto — instructions for any agent (Claude, Codex, or other)

This repo's own files are the canonical source of truth for this project. If you're an agent
reading this because a session is rooted in this folder, don't keep separate notes elsewhere that
duplicate what's here — read these instead, and update them if something's missing or wrong:

- **`CLAUDE.md`** — project overview, working rules (never auto-apply, ask before AI spend,
  secrets policy), code layout, how to run tests. Written for Claude Code but applies to any agent.
- **`.claude/skills/notion-map/SKILL.md`** — every Notion page/database ID this project uses, and
  which one answers which kind of question. Read this instead of searching Notion from scratch.
- **`.claude/skills/apply-to-job/SKILL.md`** — how to fill a job application form from an
  application kit (per-platform findings, the fast-path technique, the leak guard, the full
  automatic flow via `tools/apply-batch.sh`). Read this before filling any job form for this
  project, whether invoked by a person or by another agent.

## If you're Codex, or another agent with your own global instructions/skills/memory

Point your own global config at these files rather than keeping a second copy:
- Don't maintain a separate Notion-structure skill — use `.claude/skills/notion-map/SKILL.md`.
- Don't maintain separate job-application-filling instructions — use
  `.claude/skills/apply-to-job/SKILL.md`; update its Log and Platform notes sections with what you
  learn, the same way this project already does.
- A personal-profile cache with real contact details (email, phone, address) may live in your own
  local state if that's how you work — **never write it into this repo or any file under
  `.claude/`**. The canonical profile is the Notion **Profile — CV and Preferences** and
  **Application Answers — Standard Form Fields** pages (see notion-map for their IDs); treat a
  local cache of them as exactly that, a cache, not a second source of truth.

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
