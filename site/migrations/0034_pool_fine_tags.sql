-- Finer fixed-list labels (src/pool_tags.py, 7 Oct 2026): country ids, metro ids and role families of an install's search, comma-separated.
ALTER TABLE contributions ADD COLUMN countries TEXT NOT NULL DEFAULT '';
ALTER TABLE contributions ADD COLUMN metros TEXT NOT NULL DEFAULT '';
ALTER TABLE contributions ADD COLUMN families TEXT NOT NULL DEFAULT '';
ALTER TABLE board_reads ADD COLUMN countries TEXT NOT NULL DEFAULT '';
ALTER TABLE board_reads ADD COLUMN metros TEXT NOT NULL DEFAULT '';
ALTER TABLE board_reads ADD COLUMN families TEXT NOT NULL DEFAULT '';
