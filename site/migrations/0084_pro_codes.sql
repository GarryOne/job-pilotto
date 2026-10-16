-- The Pro device sign-in code (src/pro-signin.js, Pro spec PR 5): "I have Pro" on another computer -> an e-mail with a 6-digit code (10 minutes, 5 tries). One live code per address;
-- only a hash of the code is kept, and the code works only for the install that asked for it.
CREATE TABLE IF NOT EXISTS pro_codes (
  email_hash TEXT PRIMARY KEY,   -- guard.js digestOf(lower-cased address), the same key as pro_accounts.email_hash
  code_hash TEXT NOT NULL,
  install TEXT NOT NULL,         -- the raw install id that asked
  expires_at TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
