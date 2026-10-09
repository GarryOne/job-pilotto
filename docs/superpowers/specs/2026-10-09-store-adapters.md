# Store adapters: Notion optional, the user's data behind one interface

Status: decisions approved by the owner 9 Oct 2026 · interface: §4 (filled from the engine and desktop inventories) ·
supersedes §1 of `2026-10-03-notion-later.md` (the "connect Notion to track" gate).

> **Where it stands (9 Oct 2026, evening)** · branch `release/notion-optional` (owner: main gets no Notion work now)
> - ✅ The scheduled search, the desktop's engine commands and the button modes run on any store: one `open_stores()`,
>   the Notion tracker only while the store is Notion (no second copy in Notion beside SQLite).
> - ✅ Job Matches, ledger, interview sweep, run history (`src/run_log.py`) and import/add-a-link go through the store.
> - ⏳ **11 bridges** left (`desktop/test/bridge-registry.test.js` lists them): 9 wait on mail/inbox/opportunity/reassign
>   and the added hook (mac-20), 1 goes with mac-4a's rejection change (queued), 1 is lane G's `stores_of` (mac-e3 removes
>   it once lane H and mac-4a's apply_batch land: then no caller passes a tracker).
> - ⏳ **56 direct Notion calls** outside `src/notion`, `src/stores` still to move (audit, lane H: 64, then import_url,
>   add-a-link and feedback moved): rejection 11, opportunity 10, inbox 10, reassign 7, apply_run 7, inbox_notion 4,
>   others ≤ 2. 18 more are Notion-only by design.
> - Release gate: bridges 0 + `STORE_CHOICE` on (the registry test fails otherwise) + parity guard rows all `view`.

## 1. Decisions (owner, 9 Oct 2026; do not re-open)

| # | Decision |
|---|---|
| D1 | **Adapter pattern is a must.** One store interface; adapters `sqlite` (default) and `notion` (today's code); built so another database is one new adapter. |
| D2 | **One copy.** The active store is a setting (`store: "sqlite" \| "notion"`). Never two live copies, never a sync. |
| D3 | **User-triggered move.** "Move my data to Notion" (has data) / "Start using Notion" (no data yet). A generic `copy(from, to)`, then the setting flips. |
| D4 | **One-way for now.** No "move back to this Mac" in this effort. |
| D5 | **Always on needs Notion.** Turning it on offers the move first (GitHub runners can't reach the Mac's SQLite). |
| D6 | **Telegram and Gmail work locally** against the active store (on GitHub they follow D5). |
| D7 | **Users already on Notion see no change.** An install with a connected Notion starts as `store: "notion"`. |

## 2. Shape

```
 Screens · IPC · engine modes · Telegram · Gmail · extension
                     │
            store = open_store(settings)        ◄── the only place that picks an adapter
                     │
        ┌────────────┴────────────┐
   SqliteStore                NotionStore            (later: PostgresStore, SheetsStore …)
   data/tracker.sqlite        today's Tracker / lib/notion-*
   + profile.md, answers.md
                     │
   copy(from, to): entity by entity, idempotent (keyed by job URL hash / ids), resumable,
   progress events, then settings.store = to.  The source is archived, not deleted.
```

- **Contract suite:** one test suite parameterised by adapter (Python: `tests/store_contract.py`; JS: `desktop/test/store-contract.test.js`).
  An adapter is done when it passes it. Notion runs it against the HTTP fake already used by the Notion tests.
- **Capabilities, not `if notion`:** an adapter declares what it can do (`store.caps.openUrl`, `caps.cloud`). The UI asks
  the capability ("Open in Notion" shows only when `caps.openUrl`), never the adapter's name.
- **Notion-only features** (page blocks, links to Notion pages) are capabilities; with SQLite the screen shows the same data in the app.

## 3. Work split (each piece: own worktree, own files; mac-e4 lands them)

| Piece | Owns | Depends on |
|---|---|---|
| P0 Contract | this spec §4, `src/stores/` (interface, `open_stores`, memory reference adapter), `tests/store_contract.py` | – |
| P1 Engine SQLite | `src/stores/sqlite.py` (+ schema), engine modes on `open_store` | P0 |
| P2 Engine Notion | `src/stores/notion.py` wrapping `src/notion/*` unchanged | P0 |
| P3 Desktop adapters | `desktop/lib/store/*` (JS mirror of the interface for JS-owned entities + its contract test), IPC on the store, gates removed | P0 |
| P4 Move | `copy(from, to)` (engine), IPC + progress, Always on → move first | P1, P2 |
| P5 UI | Settings → Data card ("Your data is on this Mac" / "Move my data to Notion"), wizard + extras wording, capability-driven links | P0 (fakes), P3 |
| P6 Tests | parity test per screen fed by each adapter; e2e in sqlite mode (suite `stores`); move e2e; **export/import round trip** on sqlite, on notion and across the move (owner, 9 Oct 2026: "check import/export still works seamlessly") | P1–P3 |
| P8 Parity screens | owner, 9 Oct 2026: what only Notion shows today gets an app screen (audit: 26 things, 5 yes / 13 partial / 8 no, scratch `parity-audit.md`). **A** job page: a side panel beside the Jobs list with tabs Kit (copy buttons) · Prep · Review (rejection) · Record · Messages · Description · History. **B** full interview review + saved transcript. **C** Profile, Standard answers and Form knowledge editors + the 6 Search settings fields only Notion has. **D** weekly report in full, insight history with feedback, funnel "from previous", past form-fill runs. "Open in Notion" stays for Notion users (caps.links). Debug-only columns: kept as data, no screen | P3 |
| P7 E2E without tokens | every e2e suite runs with **no Notion token** (owner, 9 Oct 2026): sqlite store by default; the Notion path on the in-memory stand-in (`notionStandIn`, lib/notion-fake.mjs); a real test workspace only for ONE suite `notion-real` at the release gate (connect, write, read, move to Notion; owner, 9 Oct 2026) | stand-in part: now; sqlite part: after the engine callers |

P1, P2, P3 and P5 run in parallel once P0 is on main.

## 4. Interface (per entity)

**The source of truth is `src/stores/base.py`** (Protocols + `*_FIELDS`); `tests/store_contract.py` says what each
method must do; `src/stores/memory.py` is the reference adapter. Below: what each wraps in the Notion adapter.

| Entity | Methods | Notion adapter wraps (today) |
|---|---|---|
| applications | `list(stages)` `get(url)` `stages()` `create(job, stage)` `set_stage(job, stage, today)` → (record, created\|changed\|unchanged) `update(id, fields)` `delete(id)` `section/set_section(id, name, md)` `attach(id, name, bytes, type)` | `Tracker.find/url_rows/notion_jobs/url_stages/mark/_create_row/update_page/trash_page/read_kit/replace_section/upload_file` |
| events | `list(app_id, kind, source_id)` `add(app_id, kind, at, **fields)` (idempotent per source_id) `archive(app_id, kind)` | `ledger.add_event/existing_event/events_of/archive_events` |
| matches | `list(status)` `upsert(job)` `set_status(url, s)` `remove(url)` `sync(db, scored_jobs, applied, open, dismissed, partial)` (a search's whole pass; Notion: its own cached sync) | `notion/matches.py write_one/sync` |
| interviews | `list(app_id)` `get(id)` `save(id\|None, fields)` `archive(id)`; transcript/review are whole Markdown | `ai/interviews*.py` |
| insights | `list(since, category, limit)` `save(day, category, title, body, fields)` (one per day+category) | `ai/insights.py`, `interview_insights.py` |
| employers | `list(active)` `add(employer)` (one per name) | `scout_notion.py` |
| agent_runs | `add(run)` `update(id, fields)` `list(ats, limit)` | `notion/runs.py`, desktop `session-runs.js`, `transcript.js` |
| cron_runs | `begin(kind, where)` `progress(id, line)` `finish(id, status, …)` `get(id)` `list(since, kind)` | `notion/cron_runs.py`, desktop `run-history.js` |
| texts | `get(name)` `set(name, md)`, names `profile` `answers` `knowledge` | `Tracker.page_text`, desktop `writePage`, `contact.js`, `questions.js`, `knowledge.js` |

Rules decided while writing it (9 Oct 2026):
- **Search settings are not a store entity.** Their home stays `config/search.json` + `preferences.json`; with the Notion
  store they are rendered to / read from the ⚙️ page as today (`src/notion/search_settings.py`). One copy each.
- **Funnel / 🎯 Pipeline page** is a Notion rendering, not data: the SQLite store has none, the app draws it from events.
- **Choosing the adapter:** `JOB_PILOTTO_STORE` (the app passes `settings.store`), else `notion` when `NOTION_TOKEN` is set
  (Always on, terminal, every existing install: D7), else `sqlite`. Only `src/stores/__init__.py` knows adapter names.
- **SQLite adapter:** `data/tracker.sqlite` (the user's data; `data/jobs.sqlite` stays a rebuildable crawl cache), its
  own matches table, uuid ids, soft-archive for events/interviews, hard delete of an application with its sections and
  files; texts are `JOB_PILOTTO_PROFILE_FILE`/`ANSWERS_FILE` when set, else `data/texts/<name>.md`; files under
  `data/files/<app_id>/`; `caps` empty.
- **Rules above the interface stay above it:** reverting a stage, freezing the record, dedupe on `interview_at` are
  caller logic built on these methods, written once, not per adapter.
- **JS side** mirrors only what the desktop does itself (texts, cron/agent run reads and closes, transcripts, files);
  everything else is an engine command that opens the store from `JOB_PILOTTO_STORE`.

**Agent run shapes (one for every writer: the extension's runRecord, the engine's apply_run, the desktop's session stats):**
- `fields.data` = `{"fields": [{"label", "required", "source", "outcome", "confidence", "reason"}], "left_for_you": ["<label>"], "attachments": ["<name>"], "steps": [{"step": "<name>", "ms": <int>}]}`:
  the field-by-field table without answer values (never the person's words), size-capped.
- `fields.timeline` = the Claude session's status timeline as today's "Session timeline" column (a string). Step timings are `data.steps`.
- `learnings` (record field) = the Learning text; `transcript` = the conversation JSON ('💬 Conversation' on Notion).

Owners (9 Oct 2026): P0 + P4 + landing: mac-e4 · P1 sqlite: mac-ab · P2 notion + engine callers: mac-67 · P3+P5 desktop: mac-4a.

## 5. Open questions

- The Telegram worker on Cloudflare (`telegram-cloud.js`) reads Notion directly: it is a CLOUD path, so it needs the
  Notion store (D5); locally the worker's handlers get the store through the desktop (mac-4a).
