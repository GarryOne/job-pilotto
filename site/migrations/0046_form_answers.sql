-- The AI's own answers to form questions, per AI family (owner, 9 Oct 2026: compare the AI itself, Claude vs OpenAI, not the user mix).
-- One row a day and family, summed from the apps' reports (desktop/lib/answer-counts.js): calls, questions sent, answers returned, kept
-- (a known field, a value), left empty, under an unknown field id (wrong field), proposed for the person to confirm, cut at the token limit,
-- and how long calls took in buckets (<=5 s, <=10, <=20, <=40, <=80, more). Counts only: never a question, a field id or an answer.
-- ai_family from the call's own engine (familyOf), else the install's latest health report (site/src/engines.js).
CREATE TABLE IF NOT EXISTS form_answers (
  day TEXT NOT NULL, ai_family TEXT NOT NULL DEFAULT 'unknown',
  calls INTEGER NOT NULL DEFAULT 0, fields INTEGER NOT NULL DEFAULT 0, returned INTEGER NOT NULL DEFAULT 0, kept INTEGER NOT NULL DEFAULT 0,
  empty INTEGER NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0, proposed INTEGER NOT NULL DEFAULT 0, cut INTEGER NOT NULL DEFAULT 0,
  ms_5 INTEGER NOT NULL DEFAULT 0, ms_10 INTEGER NOT NULL DEFAULT 0, ms_20 INTEGER NOT NULL DEFAULT 0, ms_40 INTEGER NOT NULL DEFAULT 0,
  ms_80 INTEGER NOT NULL DEFAULT 0, ms_more INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ai_family)
);
