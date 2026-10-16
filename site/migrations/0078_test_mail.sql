-- Test inboxes: mail to test-account-*@jobpilotto.top (src/test-mail.js), kept 7 days, read only through /admin/test-mail.
CREATE TABLE test_mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '[]',
  codes TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX test_mail_to ON test_mail (to_addr, received_at);
