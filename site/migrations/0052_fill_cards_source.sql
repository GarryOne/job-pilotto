-- Where a fill card came from (docs/superpowers/specs/2026-10-10-pool-feeds-learning.md): 'user' = a real install's fill, 'pool' = the owner's nightly smoke pool
-- (stored only for the owner's key, site/src/recipes.js). Every user-facing number reads source = 'user' only; the digest's pool section reads the rest.
ALTER TABLE fill_cards ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
CREATE INDEX IF NOT EXISTS fill_cards_source ON fill_cards(source, day);
