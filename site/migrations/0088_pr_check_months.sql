-- The monthly PR-check scorecard (tools/pr-check-scorecard.mjs, pr-check-scorecard.yml): one row per month, rewritten by a repeat run in the same month.
CREATE TABLE IF NOT EXISTS pr_check_months (
  month TEXT PRIMARY KEY,               -- YYYY-MM (UTC) of the run
  card TEXT NOT NULL,                   -- JSON: {days, checks: [{name, runs, reds, realCatches, falseReds, medianMin, p90Min, addedMin, verdict}]}
  updated_at TEXT NOT NULL
);
