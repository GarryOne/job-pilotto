---
name: report-sessions-roundup
description: Coordinator's round-up of every running Job Pilotto session - one table (Session, Work, Status, Waiting on, Progress %, ETA), closed sessions left out, an overall % and the one thing everyone waits on, then what the owner should merge or decide. Use when the owner says "round-up", "roundup", "where do the sessions stand", "update the table", "what is blocking", or "/report-sessions-roundup".
---

# Sessions round-up (coordinator)

Owner, 15 Oct 2026: "when triggered, present me this report". One table, read in 5 seconds; facts measured now, never from memory.

## 1. Gather (one round, in parallel, ~1 min)
- **Who runs:** `ListAgents`. Leave out sessions the owner already closed and any not in the list. Short name = the part after `job-pilotto-`.
- **PRs:** `gh pr list --state all --limit 20 --json number,state,headRefName,title,statusCheckRollup` and count each open PR's checks: green / running / failing. A failing "all checks green" summary next to running checks is the old result: say "re-run running", not "red".
- **CI the sessions wait on:** the runs they named (recordings `record-sites.yml`, `fix-verdicts.yml`, refills): `gh run view <id> --json status,conclusion`. A run `pending`/`queued` for >10 min: say why (GitHub's parallel-job limit full, a concurrency group) after one check (`gh api repos/<repo>/actions/runs/<id>`), never a guess.
- **The Mac:** `uptime`. Load above ~20: name the cause before reporting it (memory feedback-no-artificial-load-on-mac: orphaned loops first).
- **Ask each running session for 3 lines only when its state is not visible** from PRs and runs: (1) done since last report, (2) what blocks it, (3) ETA. `SendMessage`, first line self-contained; do not wait more than ~3 min for replies: mark "no reply" and use what is measured.

## 2. The table (exact columns, a few words per cell)
| Session | Work | Status | Waiting on | Progress | ETA |
- **Progress %**: 100 = its PRs merged and nothing left (bold, ETA "**close now**"); 95 = PR green, only the owner's merge; ~85 = PR checks running; ~75 = still publishing/recording/refilling; ~5-30 = building. Be consistent with the previous table: a number goes down only with a reason said under the table.
- **Waiting on**: name the real blocker: "**your merge**" (bold when it is the owner), "CI", "GitHub's job queue", "the Mac", a peer by name, or "nothing".
- **ETA**: minutes from now, "+ merge" when the owner's merge follows. Never "soon".
- Order: done first (to close), then by progress, highest first.

## 3. Under the table (max 4 bullets)
- **Overall: ~N%** (average of the rows) and **the one wait most rows share** (the owner's merges, GitHub's queue, the Mac).
- **Ready for you to merge**, in order, with links only for PRs that turned green since the last round-up.
- **Needs your word:** decisions only the owner makes (an accept, a live visit's yes in a session's own window, spending).
- A correction of an earlier ETA or claim, said plainly.

## Coordination rules learned (15 Oct 2026, #824 blocked ~4 h)
- While a prompt-changing PR is being refilled, no new recording of a PINNED row is published (it replaces the refilled record with old-prompt answers: coreweave and Greenhouse did, twice).
- A refill publishes each group as soon as it is refilled, never all at the end.

## Never
- List a closed session, or invent a status for a session that did not reply ("no reply" is a status).
- Count a PR's stale red summary as failing while its re-run runs.
- Narrate peers' coordination: the owner sees only the table and what needs them.
