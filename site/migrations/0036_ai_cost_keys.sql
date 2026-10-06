-- What each tracked Anthropic API key cost per day (src/jobcost.js "By API key"), from the Admin API's usage report priced and scaled to that day's
-- billed total (desktop/e2e/ai-cost-report.mjs --billed). Key NAMES only (e.g. job-pilotto-e2e-testing), never a key or its id. No user data.
CREATE TABLE IF NOT EXISTS ai_cost_keys (day TEXT NOT NULL, key TEXT NOT NULL, usd REAL NOT NULL, at TEXT NOT NULL, PRIMARY KEY (day, key));
