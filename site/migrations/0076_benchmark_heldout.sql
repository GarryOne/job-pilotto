-- Benchmark Form Filling: whether a form was held out (never in our pool when it was picked), sent by the bake-off's publish step; the page's "what would make it objective" list reads it.
ALTER TABLE benchmark_runs ADD COLUMN heldout INTEGER NOT NULL DEFAULT 0;
-- oldtrail: scored before the bake-off's trail fix (a field the final page shows empty is empty); every tool's older runs can score slightly high.
ALTER TABLE benchmark_runs ADD COLUMN oldtrail INTEGER NOT NULL DEFAULT 0;
