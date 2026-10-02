-- The form lab (tools/form-lab.mjs): a daily headless browser runs the extension's real operators on public application forms with
-- a test applicant that never submits. One row per control seen, so success per site kind and per fingerprint is measured before
-- a user ever hits a failure. Product data only: public pages and anonymous structure.
CREATE TABLE lab_runs (
  day TEXT NOT NULL,
  site TEXT NOT NULL,          -- the job board (greenhouse, ashby, lever ...) or the public host
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL,
  recipe INTEGER NOT NULL DEFAULT 0,   -- the recipe version tried, 0 for the built-in operators
  ok INTEGER NOT NULL,         -- 1 worked, 0 failed
  why TEXT NOT NULL DEFAULT ''
);
CREATE INDEX lab_runs_day ON lab_runs(day, fingerprint);
