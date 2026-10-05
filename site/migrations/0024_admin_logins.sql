-- Every ?key= login to the owner's admin pages, good or bad (src/auth.js): when, from which country and device, on which page.
-- Never the key. Shown on /admin; a wrong key there is flagged.
CREATE TABLE IF NOT EXISTS admin_logins (at TEXT NOT NULL, day TEXT NOT NULL, ok INTEGER NOT NULL, country TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS admin_logins_at ON admin_logins(at);
