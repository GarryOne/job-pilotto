-- "Report this form" (docs/superpowers/specs/2026-10-15-report-this-form.md §4): one row per encrypted report an install sent. The recording itself is in the private R2 bucket
-- (binding REPORTS), encrypted with the owner's public key: this table holds counts only, never a host or a page. who = the install's salted digest, to limit and to let it delete its own.
CREATE TABLE IF NOT EXISTS form_reports (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  requests INTEGER NOT NULL,
  cause TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS form_reports_day_who ON form_reports(day, who);

-- The day's total across ALL installs (one row a day, bumped once per report): a new install id gets a new per-install quota, so this is the cap that holds (spec §6).
CREATE TABLE IF NOT EXISTS form_report_days (
  day TEXT PRIMARY KEY,
  reports INTEGER NOT NULL,
  bytes INTEGER NOT NULL
);
