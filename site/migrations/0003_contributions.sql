-- "Help the pool grow" (site/src/pool.js): opt-in, from the apps. Public facts about employer career pages and two coarse
-- tags; the install id is hashed. No person, no jobs, no CV. Kept 90 days (the daily run drops older rows).
CREATE TABLE contributions (
  install TEXT NOT NULL,      -- SHA-256 of the app's random install id + STATS_SALT (first 16 hex)
  day TEXT NOT NULL,          -- 2026-09-30 (UTC, when received)
  ats TEXT NOT NULL,
  slug TEXT NOT NULL,
  company TEXT NOT NULL,
  matched INTEGER NOT NULL,   -- this install's crawl found a job there
  own INTEGER NOT NULL,       -- the user added it themselves
  roles TEXT NOT NULL,        -- comma list from a fixed set
  regions TEXT NOT NULL,      -- comma list from a fixed set
  PRIMARY KEY (install, ats, slug)
);
CREATE INDEX contributions_day ON contributions(day);
CREATE INDEX contributions_feed ON contributions(ats, slug);
