-- The meanings pack learns (site/src/meanings.js): one vote per install for what its AI said a public wording means.
CREATE TABLE IF NOT EXISTS meaning_votes (topic TEXT NOT NULL, wording TEXT NOT NULL, answer TEXT NOT NULL, install TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (topic, wording, install));
CREATE INDEX IF NOT EXISTS meaning_votes_wording ON meaning_votes (topic, wording);
