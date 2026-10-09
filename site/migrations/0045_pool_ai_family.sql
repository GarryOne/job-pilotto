-- What installs share, by the AI family the install runs on (owner, 9 Oct 2026; src/engines.js): 'claude', 'openai' or 'unknown' (shared before
-- this, or an install with no health report yet). Set by the site from the reporting install's latest health report when a share arrives.
ALTER TABLE contributions ADD COLUMN ai_family TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE nofeed ADD COLUMN ai_family TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE board_reads ADD COLUMN ai_family TEXT NOT NULL DEFAULT 'unknown';
