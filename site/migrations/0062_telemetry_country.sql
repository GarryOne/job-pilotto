-- The country (two letters, from Cloudflare's own request data; never an address) an app's report came from, so /telemetry can say where installs are (owner, 13 Oct 2026).
-- Reports from before say nothing: NULL.
ALTER TABLE telemetry ADD COLUMN country TEXT;
