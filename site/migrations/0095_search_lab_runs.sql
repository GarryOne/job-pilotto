-- /admin/lab-job-search (owner, 18 Oct 2026): one row per candidate per replayed search (src/search-lab-store.js). Counts, seconds and a build sha only: no job titles,
-- no company names, no CV text. The last 30 runs per candidate are kept (pruned when a run is uploaded), so the page reads a few hundred rows at most.
CREATE TABLE IF NOT EXISTS search_lab_runs (
  candidate TEXT NOT NULL,
  run_at TEXT NOT NULL,
  build TEXT,
  label TEXT,
  control INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  first_s INTEGER,
  tenth_s INTEGER,
  fit_s INTEGER,
  in_places INTEGER,
  scored INTEGER,
  fit70 INTEGER,
  failed_step TEXT,
  PRIMARY KEY (candidate, run_at)
);
