-- The Fixed-site replays on /admin/applying come from CI on main only (12 Oct 2026: local runs of work-in-progress branches showed main as broken).
-- ONE row (key 'main'): the last 10 CI runs, each {sha, at, version, cases: {name: [ok, rung, note]}}, written once per merge (the D1 free plan). Read by src/applying-replays.js.
CREATE TABLE IF NOT EXISTS applying_replays (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  body TEXT NOT NULL           -- JSON
);
