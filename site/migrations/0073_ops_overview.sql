-- Where our engineering time goes (src/ops-overview.js): one row per merged PR, written once (CI: ops-overview.yml, PUT /ops/data), and one snapshot row the page reads.
CREATE TABLE IF NOT EXISTS ops_prs (number INTEGER PRIMARY KEY, day TEXT NOT NULL, merged_at TEXT NOT NULL, category TEXT NOT NULL, mixed INTEGER NOT NULL DEFAULT 0,
  lines INTEGER NOT NULL DEFAULT 0, hours REAL NOT NULL DEFAULT 0, ci_min REAL NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ops_prs_day ON ops_prs (day);
CREATE TABLE IF NOT EXISTS ops_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL, body TEXT NOT NULL);
