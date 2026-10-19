-- /admin/scouting's history, to see where the central list is strong or weak and what each run did (owner, 19 Oct 2026: "store enough
-- data ... so that we're able to iterate"). Counts only.
-- cells: the day's employers and open jobs per kind of role × European country, JSON {"<kind>|<country>": [employers, jobs]}.
ALTER TABLE index_daily ADD COLUMN cells TEXT NOT NULL DEFAULT '';
-- The central scout's last runs (src/scout_index.py run_record): when, the cell its AI ideas aimed at, names added, employers checked and found.
-- The site keeps the last 60 (src/scouting.js store).
CREATE TABLE IF NOT EXISTS scout_runs (
  at TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
