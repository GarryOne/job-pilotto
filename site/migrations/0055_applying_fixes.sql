-- /admin/applying's Fixed tab (src/applying-fixed.js): the fix ledger the owner's Mac computes from git (desktop/e2e/lib/fix-ledger.mjs: commit trailers "Pool-row:",
-- "Rung:", "Fixture:" plus desktop/e2e/pool-fixes.json) and uploads as a snapshot; the status (landed, confirmed, back) is computed from the smoke runs at view time.
CREATE TABLE IF NOT EXISTS applying_fixes (
  site TEXT NOT NULL,          -- the pool row's name as the page shows it
  commit_hash TEXT NOT NULL,   -- short hash on main
  version TEXT,                -- the extension version at that commit
  rung TEXT,                   -- the commit's Rung: trailer (0-6, router, judges)
  landed_at TEXT NOT NULL,     -- the commit's date (ISO)
  guard TEXT NOT NULL,         -- JSON list of "recorded:<case>" and "fixture:<id>"
  at TEXT NOT NULL,            -- when the snapshot was uploaded
  PRIMARY KEY (site, commit_hash)
);
-- The shapes a /fix-failing-forms session holds right now (tools/claim-shape.mjs list): names and since only, a snapshot per upload.
CREATE TABLE IF NOT EXISTS applying_claims (
  site TEXT PRIMARY KEY,
  since TEXT NOT NULL
);
-- When each snapshot kind ("fixes", "claims") was last uploaded: the page's "as of".
CREATE TABLE IF NOT EXISTS applying_snapshots (
  kind TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
