-- Applying reliability, layers 2 and 3 (docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): each recorded-page case (kind 'recorded') and
-- each nightly live-smoke site (kind 'smoke') as one row per run, uploaded by the owner's Mac (desktop/e2e/lib/applying-report.mjs). The site's host only,
-- never a posting's address; no applicant data. Read by /admin/applying (src/applying.js).
CREATE TABLE IF NOT EXISTS applying_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- 'smoke' | 'recorded'
  day TEXT NOT NULL,           -- YYYY-MM-DD of the run
  at TEXT NOT NULL,            -- when it was received
  name TEXT NOT NULL,          -- the site shape (smoke) or the case name (recorded)
  host TEXT,                   -- smoke: the posting's host
  reached TEXT,                -- smoke: none | posting | account | code/bot | form | ready
  filled INTEGER, left_n INTEGER,
  ok INTEGER,                  -- recorded: 1 passed, 0 failed
  note TEXT,                   -- recorded: the failed checks; smoke: "posting gone (HTTP 404)"
  regression INTEGER NOT NULL DEFAULT 0,
  version TEXT                 -- the extension version it ran
);
CREATE INDEX IF NOT EXISTS applying_runs_kind_name_day ON applying_runs (kind, name, day);
