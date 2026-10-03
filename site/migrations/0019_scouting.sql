-- Measuring the scouting (src/scouting.js, src/intelligence.js).
-- Installs: per source kind, also the jobs scored 70+ and the hours from a posting's date to the day it was found (a median per report:
-- summed with its count, so the page shows the mean of the reports' medians).
ALTER TABLE intel_sources ADD COLUMN good INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intel_sources ADD COLUMN hours_sum REAL NOT NULL DEFAULT 0;
ALTER TABLE intel_sources ADD COLUMN hours_n INTEGER NOT NULL DEFAULT 0;
-- The central scout: its own numbers, sent with each index it publishes (one row per day, the latest run wins). No user data.
CREATE TABLE IF NOT EXISTS scout_stats (day TEXT PRIMARY KEY, body TEXT NOT NULL);
