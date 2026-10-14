-- Pool names a full pool upload no longer lists (record-once spec, 14 Oct 2026): hidden from /admin/applying's pool table, never deleted from the run history.
-- A name comes back by being uploaded again, or by a smoke run after `at`.
CREATE TABLE IF NOT EXISTS applying_pool_retired (
  name TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
