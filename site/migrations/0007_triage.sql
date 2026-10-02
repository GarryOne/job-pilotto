-- Problems that recur (several installs, or many times) wait here to be taken by the private repo's daily triage, which files the
-- issues there (GarryOne/job-pilotto-internal). A pull, not a push: the website needs no token for a private repository.
-- kind: report (a form-structure failure, from /report/fill-failure) or problems (the daily telemetry top list).
CREATE TABLE triage_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,       -- JSON, the same scrubbed content the old workflow input held
  created_at TEXT NOT NULL,
  taken_at TEXT                -- set when the triage has taken it
);
CREATE INDEX triage_queue_open ON triage_queue(taken_at);
