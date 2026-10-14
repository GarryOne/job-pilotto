-- Where a form-filling count came from, like fill_cards.source (0052): 'user' = a real install, 'pool' = the owner's smoke pool (sent with the owner's key). The page's real-use numbers read 'user' only
-- (42 test forms of 8-9 Oct 2026 were counted as real use). Old rows are NOT backfilled: they cannot be told apart, so they stay 'user'. The source is part of each key, so a pool day never merges into a user day.
CREATE TABLE form_exposure_new (
  day TEXT NOT NULL, board TEXT NOT NULL, ai_family TEXT NOT NULL DEFAULT 'unknown', source TEXT NOT NULL DEFAULT 'user', n INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, board, ai_family, source)
);
INSERT INTO form_exposure_new (day, board, ai_family, source, n, required, starred) SELECT day, board, ai_family, 'user', n, required, starred FROM form_exposure;
DROP TABLE form_exposure;
ALTER TABLE form_exposure_new RENAME TO form_exposure;

CREATE TABLE fill_reasons_new (
  day TEXT NOT NULL, board TEXT NOT NULL, reason TEXT NOT NULL, ai_family TEXT NOT NULL DEFAULT 'unknown', source TEXT NOT NULL DEFAULT 'user', n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, board, reason, ai_family, source)
);
INSERT INTO fill_reasons_new (day, board, reason, ai_family, source, n) SELECT day, board, reason, ai_family, 'user', n FROM fill_reasons;
DROP TABLE fill_reasons;
ALTER TABLE fill_reasons_new RENAME TO fill_reasons;
