-- Our e-mail sender (src/mail.js, spec docs/superpowers/specs/2026-10-16-hosted-always-on.md §4c/§4d): one row per mail sent or refused (never the body or the address, only its hash),
-- and the addresses that must get no more mail (a bounce or complaint, or an unsubscribe from one list). The per-address daily limit counts mail_log.
CREATE TABLE IF NOT EXISTS mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,            -- ISO
  addr TEXT NOT NULL,          -- digest of the lower-cased address (guard.js digestOf)
  list TEXT NOT NULL,          -- 'service' | 'marketing'
  template TEXT NOT NULL,
  status TEXT NOT NULL,        -- 'sent' | a refusal reason (rate, suppressed, unsubscribed, not_opted_in, failed)
  message_id TEXT
);
CREATE INDEX IF NOT EXISTS mail_log_addr_at ON mail_log (addr, at);

CREATE TABLE IF NOT EXISTS mail_off (
  addr TEXT NOT NULL,
  list TEXT NOT NULL,          -- 'service' | 'marketing' | 'all' (bounce, complaint)
  reason TEXT NOT NULL,        -- 'unsubscribe' | 'bounce' | 'complaint'
  at TEXT NOT NULL,
  PRIMARY KEY (addr, list)
);
