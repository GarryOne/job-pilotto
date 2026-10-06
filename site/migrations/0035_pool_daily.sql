-- Daily totals of the pool per source and segment, kept for good (raw rows go after 90 days): seasonality needs a year (7 Oct 2026).
-- source: 'feeds' (all employer feeds) or a board id; role: a role kind; country: an ISO id or ''. Counts only: no install, no employer.
CREATE TABLE pool_daily (
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  role TEXT NOT NULL,
  country TEXT NOT NULL,
  installs INTEGER NOT NULL,
  matched INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  dup INTEGER NOT NULL DEFAULT 0,
  strong INTEGER NOT NULL DEFAULT 0,
  applied INTEGER NOT NULL DEFAULT 0,
  interview INTEGER NOT NULL DEFAULT 0,
  offer INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source, role, country)
);
