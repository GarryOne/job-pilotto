-- Which AI family an install ran on (owner, 9 Oct 2026: "differentiate the stats/metrics/successes/failures between Codex users and Claude
-- users"; by family for the metrics, by engine only for installs). The form-filling counts gain an ai_family, part of their key: 'claude'
-- (Anthropic key, Claude Code), 'openai' (OpenAI key, Codex), 'unknown' (counted before this, or an install with no health report yet).
-- The site sets it from the reporting install's latest health report (site/src/engines.js); the app sends nothing new.
CREATE TABLE form_exposure_new (
  day TEXT NOT NULL, board TEXT NOT NULL, ai_family TEXT NOT NULL DEFAULT 'unknown', n INTEGER NOT NULL DEFAULT 0, required INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, board, ai_family)
);
INSERT INTO form_exposure_new (day, board, ai_family, n, required) SELECT day, board, 'unknown', n, required FROM form_exposure;
DROP TABLE form_exposure;
ALTER TABLE form_exposure_new RENAME TO form_exposure;

CREATE TABLE flow_outcomes_new (
  day TEXT NOT NULL, board TEXT NOT NULL, state TEXT NOT NULL, ai_family TEXT NOT NULL DEFAULT 'unknown', n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, board, state, ai_family)
);
INSERT INTO flow_outcomes_new (day, board, state, ai_family, n) SELECT day, board, state, 'unknown', n FROM flow_outcomes;
DROP TABLE flow_outcomes;
ALTER TABLE flow_outcomes_new RENAME TO flow_outcomes;

CREATE TABLE fill_reasons_new (
  day TEXT NOT NULL, board TEXT NOT NULL, reason TEXT NOT NULL, ai_family TEXT NOT NULL DEFAULT 'unknown', n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, board, reason, ai_family)
);
INSERT INTO fill_reasons_new (day, board, reason, ai_family, n) SELECT day, board, reason, 'unknown', n FROM fill_reasons;
DROP TABLE fill_reasons;
ALTER TABLE fill_reasons_new RENAME TO fill_reasons;
