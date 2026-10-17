-- Where our e2e fixing time goes (src/e2e-intel.js): one row per finished release/beta e2e run, one per red suite job, and one snapshot row the page reads. No logs, no personal data.
CREATE TABLE IF NOT EXISTS e2e_runs (run_id INTEGER PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL, conclusion TEXT NOT NULL, minutes REAL NOT NULL DEFAULT 0, rules INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS e2e_runs_day ON e2e_runs (day);
CREATE TABLE IF NOT EXISTS e2e_fails (run_id INTEGER NOT NULL, suite TEXT NOT NULL, platform TEXT NOT NULL, day TEXT NOT NULL, cause TEXT NOT NULL, minutes REAL NOT NULL DEFAULT 0, rules INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (run_id, suite, platform));
CREATE INDEX IF NOT EXISTS e2e_fails_day ON e2e_fails (day);
CREATE TABLE IF NOT EXISTS e2e_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL, body TEXT NOT NULL);
