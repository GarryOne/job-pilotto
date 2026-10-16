-- Messages held for the daily or weekly digest (owner, 17 Oct 2026: new matches go at once, everything else in one digest) and each account's choice.
CREATE TABLE IF NOT EXISTS mail_held (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  at TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  buttons TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS mail_held_account ON mail_held (account, id);
ALTER TABLE pro_accounts ADD COLUMN digest_cadence TEXT NOT NULL DEFAULT 'daily';
