-- What a feed or board led to on an install over 90 days (src/contribute.py outcomes, 7 Oct 2026), as counts in fixed names:
-- {strong, saved, applied, interview, offer, remote, langs: {French: n}, senior: {junior: n}}. Boards also count `dup`: matches from employers
-- whose own feed the same check read (the board added nothing there).
ALTER TABLE contributions ADD COLUMN out_json TEXT;
ALTER TABLE board_reads ADD COLUMN out_json TEXT;
ALTER TABLE board_reads ADD COLUMN dup INTEGER;
