-- Usage-weighted pool growth (docs/superpowers/specs/2026-10-10-usage-weighted-pool.md, owner 10 Oct 2026: on by default with technical reports): which sites real
-- users' applications end on. One row per install, day and host: counts only, the host as a plain host name (no path, query, port, token or address: site/src/hostuse.js
-- checks it, the app checked it first). `install` is the same hash as contributions.install and is used only to COUNT distinct installs: a host is served only when
-- >= 3 installs used it, never with an install, and a country (joined from the install's contributions.countries) only when >= 3 installs of it did. Kept 90 days.
CREATE TABLE IF NOT EXISTS host_uses (
  install TEXT NOT NULL,
  day TEXT NOT NULL,
  host TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,       -- applications that ended on this host
  ready INTEGER NOT NULL DEFAULT 0,   -- of them, filled with nothing required left
  PRIMARY KEY (install, day, host)
);
CREATE INDEX IF NOT EXISTS host_uses_day ON host_uses(day, host);
