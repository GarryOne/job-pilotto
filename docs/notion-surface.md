# What the app asks Notion (the storage surface)

> **Why this page:** the e2e Notion stand-in implements exactly this, and a future "Notion optional" storage interface would too (6 Oct 2026).
> **Stand-in status (6 Oct 2026): paused by the owner.** `desktop/e2e/lib/notion-fake.mjs` is built and unit-tested, opt-in (`notionStandIn`, `E2E_NOTION_STANDIN=1`); the jobs suite passes on it. No suite uses it by default. Next gap when resumed: on calendar the app connects but Focus/Calendar still show the connect prompt (compare `artifacts/<suite>/notion-standin.json` with what `discover()` in `desktop/lib/notion.js` expects). Plan when resumed: dual mode, one switch per run; the beta gate always on real Notion.
> **Size:** ~10 request kinds, 11 filter operators, in 16 files (desktop `lib/notion.js`, `lib/files.js` + engine `src/notion/`, `src/focus.py`, …).

| Request | Used for |
|---|---|
| `GET users/me` | the token works (connect) |
| `POST search` | find the workspace's pages (connect, repair) |
| `POST databases` · `GET/PATCH databases/{id}` | build and repair the workspace's tables and columns (`config/notion_schema.json`) |
| `POST databases/{id}/query` (+ `start_cursor` paging) | every list: jobs, applications, events, runs, interviews, insights |
| `POST pages` · `GET/PATCH pages/{id}` | rows: create, read, update properties, archive (`archived: true`) |
| `GET blocks/{id}/children` (paged) · `PATCH blocks/{id}/children` (append, `after`) | page bodies: kits, prep, Search settings sections, run reports |
| `GET/PATCH/DELETE blocks/{id}` | edit or remove one block (a settings bullet, a marker) |
| `POST file_uploads` (+ send) | CVs and tailored CVs on their rows |

**Query filters in use:** `select.equals` (most), `url.equals`, `relation.contains`, `rich_text.equals` / `is_not_empty`, `date.on_or_after` / `equals`,
`checkbox.equals`, `title.equals`, `select.is_not_empty`, `number.greater_than`; combined with `and` / `or`; a few `sorts`.

**Behaviour the app relies on (the real-Notion contract set keeps testing these):** a query can list a row for a while after it was archived; a new
row or event can be missing from a query for seconds to minutes; archiving an archived page fails ("Can't edit block that is archived"); 429s under load.

Re-count: `grep -rhoE "'(GET|POST|PATCH|DELETE)', [\`'][a-z_]+" desktop/lib desktop/main.js` and `grep -rhoE "_request\('(GET|POST|PATCH|DELETE)'" src`.
