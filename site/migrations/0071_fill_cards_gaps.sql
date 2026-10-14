-- What each unanswered required field was about and whether it was left on purpose, as fixed words: {"meaning:cause:design|gap": count} (extension/fill-meaning.js,
-- checked again by cleanCard). Never a question's wording or a value. Old rows stay '{}' (no backfill, like 0069/0070).
ALTER TABLE fill_cards ADD COLUMN gaps TEXT NOT NULL DEFAULT '{}';
