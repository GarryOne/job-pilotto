-- Benchmark Form Filling: which bake-off harness fixes a run was scored BEFORE (comma list of keys, e.g. trail, select); replaces the single oldtrail flag, which is kept and carried over.
ALTER TABLE benchmark_runs ADD COLUMN fixes TEXT NOT NULL DEFAULT '';
UPDATE benchmark_runs SET fixes = 'trail' WHERE oldtrail = 1;
