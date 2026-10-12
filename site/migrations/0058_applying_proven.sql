-- "Proven live" on /admin/applying's Fixed tab (12 Oct 2026): CI sends ONE record per pool run that really ran a row (src/applying-proven.js, PUT /applying/proven, the narrow
-- REPLAYS_PUBLISH_KEY). ONE row (key 'main'): the last 100 records, each {row, sha, branch, pr, subjects, reached, applicant, run, at}, one write per upload (the D1 free plan).
CREATE TABLE IF NOT EXISTS applying_proven (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  body TEXT NOT NULL           -- JSON
);
-- A fix's commit subject: the PR's own build is matched to a merged fix by subject and row (rebase-merge changes the sha).
ALTER TABLE applying_fixes ADD COLUMN subject TEXT;
