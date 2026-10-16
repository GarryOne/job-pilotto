-- The daily build digest (spec docs/superpowers/specs/2026-10-16-daily-digest.md): one row per Zurich day, rewritten by each draft (at most 8 a day) until the final one at 23:00.
CREATE TABLE IF NOT EXISTS digest_days (
  day TEXT PRIMARY KEY,                 -- YYYY-MM-DD, Europe/Zurich
  groups TEXT NOT NULL,                 -- JSON: [{emoji, title, bullets: [{lead, text, prs}]}]
  open_line TEXT NOT NULL DEFAULT '',   -- the "Still open" line
  numbers TEXT NOT NULL,                -- JSON: the merged PR numbers the digest covers (a draft is rebuilt only when this set changes)
  drafts INTEGER NOT NULL DEFAULT 1,
  usd REAL NOT NULL DEFAULT 0,          -- AI spend on this day's digests, summed
  updated_at TEXT NOT NULL,
  final_at TEXT                         -- set by the 23:00 run; the day is then closed
);
