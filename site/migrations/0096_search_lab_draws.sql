-- /admin/lab-job-search "Random draws" tab (owner, 18 Oct 2026): one row per daily CI draw (a random role family in a random European city, a fictional CV; src/search-lab-draws.js).
-- Counts, seconds and a build sha only: no job titles, company names or CV text. Own table, so the Lab's six fixed candidates and the Real installs never mix with it.
CREATE TABLE IF NOT EXISTS search_lab_draws (
  draw_date TEXT PRIMARY KEY,
  seed TEXT NOT NULL,
  family TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ci',
  build TEXT,
  state TEXT NOT NULL,
  first_s INTEGER,
  tenth_s INTEGER,
  fit_s INTEGER,
  in_places INTEGER,
  scored INTEGER,
  fit70 INTEGER,
  failed_step TEXT
);
