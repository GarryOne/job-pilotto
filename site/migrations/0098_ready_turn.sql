-- Ready to send, one fill per press (PR #1455's image check filled j1 six times from a stale list): a row's turn counts up at each Fill again
-- (src/ready-line.js requeue); the night's list carries it, and the container fills each (form, turn) once (hosted/ready-fill/night.mjs pressOf).
ALTER TABLE ready_jobs ADD COLUMN turn INTEGER NOT NULL DEFAULT 0;
