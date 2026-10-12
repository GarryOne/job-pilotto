-- The outcome contract (12 Oct 2026, spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1a; src/applying-resolution.js): each pool run's ending, a fixed word
-- (ready, told, handed, blind, data_missing, site_broken, unresolved, or held = the test's own hold). The owner's Mac uploads carry it into their run row; CI's runs send theirs
-- with the narrow key (PUT /applying/endings), kept as ONE row (key 'all') with the last 600 records, one write per upload (the D1 free plan).
ALTER TABLE applying_runs ADD COLUMN ending TEXT;
CREATE TABLE IF NOT EXISTS applying_endings (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  body TEXT NOT NULL           -- JSON: [{row, ending, run, branch, sha, at}]
);
