-- Three more things the installs teach (src/intelligence.js). Counts by fixed tags or public form wording: no job title, company, answer or install.
CREATE TABLE intel_replies (      -- marked outcomes by the job's fit-score band: does a higher score get more replies?
  day TEXT NOT NULL, bucket TEXT NOT NULL, outcome TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, bucket, outcome)
);
CREATE TABLE intel_sources (      -- a daily count per job-board kind (a known ATS name, or "other"): seen, acted on, dismissed, heard back
  day TEXT NOT NULL, board TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, acted INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0,
  heard INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, board)
);
CREATE TABLE intel_fixes (        -- a form question's wording: times the filler answered it, times the person changed the answer by hand
  label TEXT PRIMARY KEY, filled INTEGER NOT NULL DEFAULT 0, corrected INTEGER NOT NULL DEFAULT 0, installs TEXT NOT NULL DEFAULT '[]', last_day TEXT NOT NULL
);
