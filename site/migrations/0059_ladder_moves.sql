-- The ladder's learned moves (12 Oct 2026, spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1; src/ladder-moves.js): what a page CONFIRMED of a decision (the form
-- came after the press, the fill took values), per page shape, decision and SOURCE. 'user': an install's learning batch (who = its hashed install, hits and misses add up);
-- 'ci': the CI pool (who = 'ci:<run id>', a re-sent run adds nothing); 'replay': the recorded pages on main (who = 'replay', kept once). Fixed values and integers only:
-- the shape is host + path template + build (no query, no text). Not served to installs yet (phase 3: the pack's k>=3 rule).
CREATE TABLE IF NOT EXISTS ladder_moves (
  shape TEXT NOT NULL,
  rung INTEGER NOT NULL,       -- 0 structure, 1 kept, 2 sketch, 3 digest, 4 picture, 5 Claude, 6 the person
  kind TEXT NOT NULL,          -- the page kind ('' from an app before it was counted)
  outcome TEXT NOT NULL,
  source TEXT NOT NULL,        -- 'user' | 'ci' | 'replay'
  who TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL,
  PRIMARY KEY (shape, rung, kind, outcome, source, who)
);
