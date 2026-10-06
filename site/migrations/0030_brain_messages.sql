-- The product brain's log (src/brainlog.js): every message the "Job Pilotto Brain" bot sends (a recommendation, a plan, a status
-- change) and every button tap, as /admin/brain reads them. Notion ("🧭 Product Brain · Decisions") keeps its rows; this is the copy
-- the page reads. `decision` is the Notion page id without dashes; a decision's status now is its newest row's.
CREATE TABLE IF NOT EXISTS brain_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision TEXT NOT NULL,
  kind TEXT NOT NULL,          -- recommendation | plan | status | tap
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  notion_url TEXT NOT NULL DEFAULT '',
  telegram_id INTEGER,
  source TEXT NOT NULL DEFAULT 'brain',   -- brain (tools/product_brain.py) | tap (src/brain.js) | backfill (from Notion, once)
  at TEXT NOT NULL,
  UNIQUE (decision, kind, status, at)
);
CREATE INDEX IF NOT EXISTS brain_messages_at ON brain_messages (at);
CREATE INDEX IF NOT EXISTS brain_messages_decision ON brain_messages (decision);
