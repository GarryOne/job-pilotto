-- Share v2 (src/contribute.py, docs/superpowers/specs/2026-10-06-central-employer-learning.md): per feed, how the install found it (fixed
-- words), jobs it lists, jobs that matched the install's search in its places, the employer's own job-site address, and whether the read failed.
ALTER TABLE contributions ADD COLUMN how TEXT;
ALTER TABLE contributions ADD COLUMN jobs INTEGER;
ALTER TABLE contributions ADD COLUMN hits INTEGER;
ALTER TABLE contributions ADD COLUMN site TEXT;
ALTER TABLE contributions ADD COLUMN failed INTEGER;
