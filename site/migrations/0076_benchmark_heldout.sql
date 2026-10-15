-- Benchmark Form Filling: whether a form was held out (never in our pool when it was picked), sent by the bake-off's publish step; the page's "what would make it objective" list reads it.
ALTER TABLE benchmark_runs ADD COLUMN heldout INTEGER NOT NULL DEFAULT 0;
