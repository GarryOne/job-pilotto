-- Sites of the smoke pool that are running right now (docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): the owner's Mac pings "start" when a site's run begins and
-- "end" when it ends (desktop/e2e/lib/applying-report.mjs). /admin/applying shows a spinner for a row seen within 5 minutes; a run that died leaves a row that simply goes stale.
CREATE TABLE IF NOT EXISTS applying_running (
  name TEXT PRIMARY KEY,   -- the site shape (the same name smoke and pool rows use)
  at TEXT NOT NULL         -- when the start ping was received
);
