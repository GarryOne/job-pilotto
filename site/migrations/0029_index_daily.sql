-- The central employer list, one snapshot a day, written when the central scout publishes (src/employers.js publish): the growth over time
-- on /admin/scouting. Counts only.
CREATE TABLE IF NOT EXISTS index_daily (
  day TEXT PRIMARY KEY,
  feeds INTEGER NOT NULL,
  non_it INTEGER NOT NULL DEFAULT 0,
  failing INTEGER NOT NULL DEFAULT 0,
  from_pool INTEGER NOT NULL DEFAULT 0,
  dead_ends INTEGER NOT NULL DEFAULT 0
);
