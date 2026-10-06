-- Job boards and other non-employer sources an install's jobs check read (src/contribute.py boards, 7 Oct 2026): a fixed board id, the install's
-- fixed-list role / region tags, jobs listed, jobs that matched, and a failed read. Counts only; kept 90 days like contributions. It tells which
-- boards work for which kind of role in which region.
CREATE TABLE board_reads (
  install TEXT NOT NULL,
  day TEXT NOT NULL,
  board TEXT NOT NULL,
  roles TEXT NOT NULL,
  regions TEXT NOT NULL,
  jobs INTEGER,
  hits INTEGER,
  failed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install, board)
);
CREATE INDEX board_reads_day ON board_reads(day);
