-- Self-improving form filling (Notion: "Self-improving form filling: design & plan"). Product data only; nothing about a user.
-- recipes: how to operate one kind of control, as data (extension/recipe-schema.js), by structural fingerprint. A recipe starts
--   as a candidate, runs as a canary on a share of installs (rollout %), becomes verified at 100%, or is disabled.
-- control_samples: the scrubbed structure (no text, values or ids) of a control kind, a few per fingerprint, for proposing recipes.
-- control_outcomes: per day, fingerprint and recipe version, how often the operators worked or failed: the canary's evidence.
CREATE TABLE recipes (
  fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,        -- candidate, canary, verified, disabled
  rollout INTEGER NOT NULL DEFAULT 0,   -- % of installs that use it (canary), 100 when verified
  body TEXT NOT NULL,          -- the recipe, JSON, validated by recipe-schema.js
  source TEXT NOT NULL,        -- lab, owner, claude
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (fingerprint, version)
);
CREATE INDEX recipes_status ON recipes(status);
CREATE TABLE control_samples (
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL,
  skeleton TEXT NOT NULL,      -- JSON, ≤ 6 KB, tags/roles/aria/class words only
  question TEXT NOT NULL DEFAULT '',   -- the form's own question text, ≤ 120 chars
  seen_at TEXT NOT NULL
);
CREATE INDEX control_samples_fp ON control_samples(fingerprint);
CREATE TABLE control_outcomes (
  day TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  recipe INTEGER NOT NULL DEFAULT 0,   -- the recipe version used, 0 for the built-in operators
  ok INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, fingerprint, recipe)
);
