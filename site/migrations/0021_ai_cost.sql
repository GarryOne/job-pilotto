-- What the product's own scheduled jobs spend on AI (src/jobcost.js), reported by each job at the end of its run (tools/ai-cost-report.mjs,
-- PUT /ai-cost/data with AI_COST_PUBLISH_KEY). One row per (job, run): a retried report replaces itself, so nothing is counted twice.
-- ai_cost_billed: what Anthropic itself billed per day (Admin API cost report), to show how much of the bill the jobs explain. No user data.
CREATE TABLE IF NOT EXISTS ai_cost_runs (job TEXT NOT NULL, run_id TEXT NOT NULL, day TEXT NOT NULL, at TEXT NOT NULL, usd REAL NOT NULL, calls INTEGER NOT NULL DEFAULT 0, repo TEXT, PRIMARY KEY (job, run_id));
CREATE INDEX IF NOT EXISTS ai_cost_runs_day ON ai_cost_runs (day);
CREATE TABLE IF NOT EXISTS ai_cost_billed (day TEXT PRIMARY KEY, usd REAL NOT NULL, at TEXT NOT NULL);
