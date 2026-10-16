-- Hosted Always on (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md §1, §2, §5): the schedule (one per account), the run log, and the result inbox the app pulls.
-- Behind env.HOSTED_ALWAYS_ON = off | on. The person's own state (jobs.sqlite, profile, CV) lives encrypted in R2 (PR 3), never in D1.
CREATE TABLE IF NOT EXISTS hosted_schedules (
  account TEXT PRIMARY KEY,               -- pro_accounts.id: ONE schedule per account
  install TEXT NOT NULL,                  -- the raw install id that set it (the app's key proves it)
  freq_hours INTEGER NOT NULL DEFAULT 24, -- 24 for a trial; Pro later 4..24
  next_run_at TEXT NOT NULL,              -- ISO: the cron tick runs rows whose time has come
  state TEXT NOT NULL DEFAULT 'on',       -- 'on' | 'paused' | 'off'
  pause_reason TEXT,                      -- 'inactive' | 'budget' | 'guard' | 'bounce' | 'trial-over' | 'owner'
  email_channel INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,             -- the last app contact or email click: the 14-day auto-pause reads it
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hosted_schedules_due ON hosted_schedules (state, next_run_at);
CREATE TABLE IF NOT EXISTS hosted_runs (
  id TEXT PRIMARY KEY,                    -- run id; the run token is an HMAC of it
  account TEXT NOT NULL,
  slot TEXT NOT NULL,                     -- 'YYYY-MM-DDTHH' of the due time: UNIQUE(account, slot) is the dedupe
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,               -- the run token stops working here (30 min)
  finished_at TEXT,                       -- set by the one result post
  status TEXT NOT NULL DEFAULT 'running', -- 'running' | 'ok' | 'failed'
  new_count INTEGER NOT NULL DEFAULT 0,
  compute_micro INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account, slot)
);
CREATE INDEX IF NOT EXISTS hosted_runs_account ON hosted_runs (account, started_at);
CREATE TABLE IF NOT EXISTS hosted_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  run TEXT NOT NULL,
  job TEXT NOT NULL,                      -- the job's id in the run's store
  payload TEXT NOT NULL,                  -- JSON: title, company, url, fit, one line (what the app merges)
  at TEXT NOT NULL,
  UNIQUE (account, job)
);
CREATE INDEX IF NOT EXISTS hosted_inbox_account ON hosted_inbox (account, id);
