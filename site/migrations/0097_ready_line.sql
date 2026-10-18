-- Ready to send, a row's live line and Stop (owner, 18 Oct 2026: "a line with live updates from each row", "a stop button once a row started"): the step the night's fill is on
-- (a fixed word from src/ready-line.js), its count, when the row started filling, and the result a Fill again replaced (put back when it is stopped).
ALTER TABLE ready_jobs ADD COLUMN step TEXT;
ALTER TABLE ready_jobs ADD COLUMN step_n INTEGER;
ALTER TABLE ready_jobs ADD COLUMN started_at TEXT;
ALTER TABLE ready_jobs ADD COLUMN again_from TEXT;
