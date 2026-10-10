-- /admin/applying: the AI ladder's rung (0 to 6) that made a run's last decision, and why a site was blocked there (smoke), or the rung a recorded case guards.
ALTER TABLE applying_runs ADD COLUMN rung INTEGER;
ALTER TABLE applying_runs ADD COLUMN signal TEXT;   -- unsure | contradicted | stalled | failed; null = unknown
