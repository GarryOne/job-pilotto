-- Each install's latest health report (src/engines.js LATEST_ENGINE: which AI it runs on) without scanning every health row once per health row
-- (14 Oct 2026: that correlated MAX read ~120k rows per admin page view, 730k a day). Partial: only health rows are indexed, so other telemetry writes cost nothing extra.
CREATE INDEX IF NOT EXISTS telemetry_health_latest ON telemetry(install, at) WHERE kind = 'health';
