-- Posting addresses installs share for the daily discovery batch (src/discovery-candidates.js): the public address, its host and where it came from, per install (hashed), 14 days.
CREATE TABLE IF NOT EXISTS discovery_candidates (
  install TEXT NOT NULL,
  day TEXT NOT NULL,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  source TEXT NOT NULL,   -- 'matches' | 'applying'
  PRIMARY KEY (install, url)
);
CREATE INDEX IF NOT EXISTS discovery_candidates_day ON discovery_candidates(day);
