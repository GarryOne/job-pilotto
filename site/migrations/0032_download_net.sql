-- Which channel a downloaded app came from (src/attribution.js): a download click keeps a salted hash of its network address,
-- so the app's first start (GET /api/attribution) can be matched to it. Deleted after 8 days by the daily cron; never shown.
ALTER TABLE downloads ADD COLUMN net TEXT;
CREATE INDEX IF NOT EXISTS downloads_net ON downloads (net);
