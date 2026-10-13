-- What a control repair did, per control fingerprint and verb (13 Oct 2026, spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR D2; src/repair-evidence.js): how often the fill
-- ladder's repair of a control worked or failed. Same sources as ladder_moves: 'user' (an install's batch, who = its hashed install, counts add up), 'ci' (the CI pool, who = 'ci:<run id>',
-- a re-sent run adds nothing), 'replay' (the recorded pages on main, who = 'replay', kept once). Fixed values and integers only: fp is the control's structural fingerprint
-- (page/skeleton.js: no text, ids or values), verb a fill_repair verb. Not served to installs yet (the pack's k>=3 rule comes with serving).
CREATE TABLE IF NOT EXISTS repair_evidence (
  fp TEXT NOT NULL,
  verb TEXT NOT NULL,
  source TEXT NOT NULL,        -- 'user' | 'ci' | 'replay'
  who TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL,
  PRIMARY KEY (fp, verb, source, who)
);
