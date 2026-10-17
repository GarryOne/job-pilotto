-- Ready to send (src/ready-tick.js): when a night should start filling; NULL = at the next cron tick.
ALTER TABLE ready_batches ADD COLUMN fill_at TEXT;
