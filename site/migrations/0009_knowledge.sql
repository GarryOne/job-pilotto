-- What installs report so the product can learn meanings and flows (Notion: "Knowledge as data: build plan"). Product data only.
-- question_labels: the wording of form questions no answer matched (public form text, cleaned on the Mac and again here), with how
--   many times and from which installs (a few short digests, enough to count "3 or more installs"). A label reported by fewer than 3
--   installs is deleted after 14 days: one person's odd question is never kept.
-- flow_outcomes: where an application got to on a board: filled, fill-error, account, no-form, no-form-after-apply (counts per day).
CREATE TABLE question_labels (
  label TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  installs TEXT NOT NULL DEFAULT '[]',    -- JSON, up to 5 short digests of install ids
  boards TEXT NOT NULL DEFAULT '[]',      -- JSON, up to 8 board names
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL
);
CREATE INDEX question_labels_last ON question_labels(last_day);
CREATE TABLE flow_outcomes (
  day TEXT NOT NULL,
  board TEXT NOT NULL,
  state TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, board, state)
);
