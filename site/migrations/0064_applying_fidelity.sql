-- /admin/applying's "Replay vs live (prototype)" (13 Oct 2026, src/applying-fidelity.js): per pool row, how close an offline replay of its live run came to that run (the snapshot replay of today
-- and the network replay of the new design). ONE row (key 'prototype'): the newest record of each pool row, counts and words only, written once per upload (the D1 free plan).
CREATE TABLE IF NOT EXISTS applying_fidelity (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  body TEXT NOT NULL           -- JSON: [{name, sha, branch, at, live, snapshot, network?}]
);
