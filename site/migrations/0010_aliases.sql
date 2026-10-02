-- Label meanings (site/src/aliases.js; format extension/alias-schema.js): a phrase on a form stands for one profile field. Product data only.
-- status: candidate (proposed), canary (a share of installs, `rollout` %), verified (everyone), disabled (refused or halted; kept so it is not proposed again).
-- alias_outcomes: how often an alias placed a question and the field took the value, per day: the canary's evidence.
CREATE TABLE aliases (
  phrase TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  status TEXT NOT NULL,
  rollout INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,        -- proposer, owner, claude
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX aliases_status ON aliases(status);
CREATE TABLE alias_outcomes (
  day TEXT NOT NULL,
  phrase TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, phrase)
);
