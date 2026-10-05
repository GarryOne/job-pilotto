-- People the owner invited to read the admin pages (src/auth.js): a single-use invite link (only its SHA-256 is kept), an
-- expiry, and a revoke. A guest reads every admin page with people's contact details hidden, and changes nothing.
CREATE TABLE IF NOT EXISTS admin_people (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  revoked_at TEXT, invite_hash TEXT NOT NULL, invite_used_at TEXT, last_seen TEXT);
ALTER TABLE admin_logins ADD COLUMN person TEXT NOT NULL DEFAULT '';
