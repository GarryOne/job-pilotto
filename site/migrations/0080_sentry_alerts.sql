-- Which Sentry issues the Sentry Telegram bot already told the owner about (src/sentry-alert.js): one row per issue and kind.
CREATE TABLE sentry_alerts (
  issue_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  told_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (issue_id, kind)
);
CREATE INDEX sentry_alerts_told ON sentry_alerts (told_at);
