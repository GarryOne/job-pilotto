-- Ready to send, phase 1 (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): one night's batch and its jobs. Counts and states only: the batch itself (url, kit, CV, contact) lives encrypted in R2 and is deleted.
CREATE TABLE IF NOT EXISTS ready_batches (
  id TEXT PRIMARY KEY, install TEXT NOT NULL, night TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT,
  state TEXT NOT NULL DEFAULT 'queued',            -- queued | running | finished | capped | deleted
  cost_micro INTEGER NOT NULL DEFAULT 0, finished_at TEXT, deleted_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ready_batches_night ON ready_batches (install, night);
CREATE TABLE IF NOT EXISTS ready_jobs (
  batch TEXT NOT NULL, job TEXT NOT NULL, host TEXT NOT NULL DEFAULT '',   -- the host of the posting, never the address
  state TEXT NOT NULL DEFAULT 'queued',            -- queued | prepared (no required field left) | partial | wall | no-form | failed (the fill's outcome, kept for the count)
  filled INTEGER, left_empty INTEGER, human_check INTEGER, wall TEXT, ms INTEGER, cost_micro INTEGER NOT NULL DEFAULT 0, at TEXT, submitted_at TEXT, cleared_at TEXT,   -- cleared_at: the job's data was deleted (Done, 24 h, Delete everything)
  PRIMARY KEY (batch, job));
