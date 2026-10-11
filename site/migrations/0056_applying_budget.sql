-- D1 read/write budget (11 Oct 2026: the free plan's daily limit was hit). /admin/applying no longer scans applying_runs on every load:
-- applying_latest keeps each site's (or case's) last runs as one JSON row, written on upload; applying_view keeps computed snapshots of the page's data
-- ("fast": at most 10 minutes old, dropped by every upload; "slow:*": the big readers, an hour). Read by src/applying-store.js.
CREATE TABLE IF NOT EXISTS applying_latest (
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  runs TEXT NOT NULL,          -- JSON: the last runs of this (kind, name), oldest first
  PRIMARY KEY (kind, name)
);
CREATE TABLE IF NOT EXISTS applying_view (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  body TEXT NOT NULL           -- JSON
);
