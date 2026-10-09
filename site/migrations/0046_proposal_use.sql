-- What people do with a proposed answer on the session page (desktop/lib/proposal-use.js, owner 9 Oct 2026: "how are we improving from
-- one iteration to another ... by leveraging data"). Counts only: per day, the form's board, where the proposal came from (source), what
-- happened (act: shown / used / edited), the app's version and the install's AI family. Never a value or a question's wording.
CREATE TABLE IF NOT EXISTS proposal_use (
  day TEXT NOT NULL, board TEXT NOT NULL, source TEXT NOT NULL, act TEXT NOT NULL, version TEXT NOT NULL DEFAULT '',
  ai_family TEXT NOT NULL DEFAULT 'unknown', n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, board, source, act, version, ai_family)
);
