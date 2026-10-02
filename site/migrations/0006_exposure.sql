-- Where users actually are, so the form lab spends its time there (src/recipes.js plan). Counts only; no install, no employer:
-- form_exposure: per day and job board (known boards named, other sites a short hash), how many forms were filled.
-- lab_runs.url: the PUBLIC page a control was seen on (no query, no personal data), so the lab can revisit the ones that matter.
CREATE TABLE form_exposure (
  day TEXT NOT NULL,
  board TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, board)
);
ALTER TABLE lab_runs ADD COLUMN url TEXT NOT NULL DEFAULT '';
