-- The self-healing loop's numbers (src/selfheal.js), published by CI every 3 hours (self-heal-stats.yml, PUT /self-heal/data with SELFHEAL_PUBLISH_KEY).
-- One row per day, the latest publish of the day wins: the page shows today and the trend. No user data: issue counts, titles of the loop's own issues, costs.
CREATE TABLE IF NOT EXISTS selfheal_snapshots (day TEXT PRIMARY KEY, at TEXT NOT NULL, body TEXT NOT NULL);
