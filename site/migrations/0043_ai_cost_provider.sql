-- Which AI provider a job's run spent on (owner, 9 Oct 2026: /ai-cost shows Claude and OpenAI separately, and the total). Reports from before say nothing: Anthropic.
ALTER TABLE ai_cost_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic';
