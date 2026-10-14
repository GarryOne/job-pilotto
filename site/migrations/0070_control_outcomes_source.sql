-- Where an operator outcome came from, like fill_cards.source (0052, 0069): 'user' = a real install, 'pool' = the owner's smoke pool, 'replay' = an offline replay (both sent with the owner's key).
-- The canary and the digest judge on 'user' only; the proposer's target list ranks 'user' failures first and lab ones second. Old rows are NOT backfilled: they cannot be told apart, so they stay 'user'.
-- why: the latest fixed reason word (extension/page/controls.js, desktop/lib/recipes.js WHY_WORDS) for a failed attempt, so the proposer can read why a control was left; never free text.
CREATE TABLE control_outcomes_new (
  day TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  recipe INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',
  ok INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  why TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (day, fingerprint, recipe, source)
);
INSERT INTO control_outcomes_new (day, fingerprint, recipe, source, ok, failed) SELECT day, fingerprint, recipe, 'user', ok, failed FROM control_outcomes;
DROP TABLE control_outcomes;
ALTER TABLE control_outcomes_new RENAME TO control_outcomes;
