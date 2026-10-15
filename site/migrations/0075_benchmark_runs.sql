-- Benchmark Form Filling (src/benchmark.js): one summary row per scored run (a tool on a form), written once by the bake-off's publish step (PUT /benchmark/data), and one snapshot row the page reads.
CREATE TABLE IF NOT EXISTS benchmark_runs (id TEXT PRIMARY KEY, at TEXT NOT NULL, applicant TEXT NOT NULL DEFAULT 'thin', mode TEXT NOT NULL DEFAULT 'user', tool TEXT NOT NULL, ours INTEGER NOT NULL DEFAULT 0, build TEXT NOT NULL DEFAULT '',
  form TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0, right INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0, empty INTEGER NOT NULL DEFAULT 0,
  unans INTEGER NOT NULL DEFAULT 0, holds INTEGER NOT NULL DEFAULT 0, dups INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS benchmark_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL, body TEXT NOT NULL);
