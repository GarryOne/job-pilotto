-- Technical reports from Job Pilotto apps (site/src/telemetry.js; the app scrubs them first: desktop/lib/telemetry.js).
-- No personal data: a random install id, version, OS, and the event's technical fields. Kept 90 days.
-- Applied by the site's deploy (.github/workflows/site.yml: wrangler d1 migrations apply).
CREATE TABLE telemetry (
  day TEXT NOT NULL,          -- 2026-09-29 (UTC, when received)
  at TEXT NOT NULL,           -- the event's own time
  kind TEXT NOT NULL,         -- crash, run_failed, form_issue, stuck, health
  install TEXT NOT NULL,      -- random per install
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  fingerprint TEXT NOT NULL,  -- the same problem across users (kind + where + what)
  summary TEXT NOT NULL,      -- one line for people
  data TEXT NOT NULL          -- the event as sent (JSON, ≤ 8 KB)
);
CREATE INDEX telemetry_day ON telemetry(day);
CREATE INDEX telemetry_fingerprint ON telemetry(fingerprint, day);
