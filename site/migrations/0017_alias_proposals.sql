-- Meanings the installs propose (src/aliases.js storeProposals): a label wording and the fixed profile field a learned note says it stands for.
-- Public form wording and a fixed field name only: no answer, no value. installs = short digests; 3+ of them make the pair a candidate alias.
CREATE TABLE alias_proposals (
  phrase TEXT NOT NULL, key TEXT NOT NULL, installs TEXT NOT NULL DEFAULT '[]', last_day TEXT NOT NULL, PRIMARY KEY (phrase, key)
);

-- Why fields stayed empty, per board and fixed reason word (no_answer, not_taken, real_click, no_option, other): which reason costs the most forms.
CREATE TABLE fill_reasons (
  day TEXT NOT NULL, board TEXT NOT NULL, reason TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, board, reason)
);
