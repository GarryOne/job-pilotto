-- One anonymous row per form fill (extension/fill-card.js via the app's shared counts): the learning digest's raw material
-- (src/digest.js). Counts and fixed words only: no answer, no question wording, no field id, no address; the board is a known
-- job board's name or a short hash. At Submit the same row gets whether it was submitted and what the person answered themselves.
CREATE TABLE IF NOT EXISTS fill_cards (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, board TEXT NOT NULL, version TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 0, filled INTEGER NOT NULL DEFAULT 0, left_n INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0,
  optional INTEGER NOT NULL DEFAULT 0, optional_filled INTEGER NOT NULL DEFAULT 0,
  causes TEXT NOT NULL DEFAULT '{}', kinds TEXT NOT NULL DEFAULT '{}', ai TEXT NOT NULL DEFAULT '', kit INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0,
  submitted INTEGER NOT NULL DEFAULT 0, by_you INTEGER NOT NULL DEFAULT 0, by_you_unread INTEGER NOT NULL DEFAULT 0, page_error INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS fill_cards_day ON fill_cards(day, board);
