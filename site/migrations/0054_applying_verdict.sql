-- /admin/applying: the runner's verdict on a form it reached (desktop/e2e/lib/smoke.mjs shortfall): how many fields were asked, and how many of them are unexplained (a miss, or no suggestion).
-- Null = a run without a field list (an older run): the page falls back to the filled and left counts.
ALTER TABLE applying_runs ADD COLUMN asked INTEGER;
ALTER TABLE applying_runs ADD COLUMN unexplained INTEGER;
