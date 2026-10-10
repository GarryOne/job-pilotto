-- The smoke pool (docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): one row per site of the pool, so /admin/applying lists every site, also one never run.
-- Uploaded by the owner's Mac with each smoke or discovery run (desktop/e2e/lib/applying-report.mjs). Hosts and a fixed-word flow signature only, never a posting's address.
-- The platform and the flow are worked out when the page is read (src/platform.js), from the start host and the signature's end host.
CREATE TABLE IF NOT EXISTS applying_pool (
  name TEXT PRIMARY KEY,       -- the site shape (the same name smoke rows use)
  start_host TEXT,             -- the host of the posting the journey starts on
  signature TEXT,              -- lib/smoke.mjs signature(): page kinds in order @ end host # how far it got
  at TEXT NOT NULL,            -- when it was last received
  version TEXT
);
