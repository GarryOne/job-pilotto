-- What the AI costs us, per step, on the relay that carries included AI (src/trial.js; Notion "Free / Pro split: build plan", workstream A).
-- One row per day, license holder (a short digest, never the key or its owner), AI step and model: how many calls, the tokens and the cost.
-- No prompt, no answer, no job text: only counts. The step is a fixed word the app sends in a header.
CREATE TABLE ai_calls (
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  action TEXT NOT NULL,        -- enrich, score, kit, prep, insight, mail, inbox, review, interview, opportunity, added, import, other
  model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  micro_usd INTEGER NOT NULL DEFAULT 0,   -- millionths of a dollar, so sums stay exact
  PRIMARY KEY (day, who, action, model)
);
