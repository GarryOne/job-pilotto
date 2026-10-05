-- Answers the filler gave and the person then changed by hand, per day (all questions together): the trend of "Answers people
-- change" on /admin/insights. intel_fixes keeps the per-question totals, with no day.
CREATE TABLE IF NOT EXISTS intel_fix_days (day TEXT PRIMARY KEY, filled INTEGER NOT NULL DEFAULT 0, corrected INTEGER NOT NULL DEFAULT 0);
