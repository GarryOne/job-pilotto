-- /admin/applying's "Confirmed offline" (14 Oct 2026, src/applying-verify.js): the offline replays' verdicts for landed fixes and for rows that got less far, ONE row (key 'main'),
-- each row's last verdict replaced by name when CI sends a new one (the D1 free plan). Fixed words and a short reason only: no page text, no URL.
CREATE TABLE IF NOT EXISTS applying_verify (
  key TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  body TEXT NOT NULL           -- JSON: [{kind, row, verdict, why, commit?, buildBy?, recordedAt?, olderAt?, at, sha}]
);
