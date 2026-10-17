// Ready to send, the cron side (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): on the existing 5-minute tick, a queued night whose fill time has come gets its night token and one message on the Queue `ready-runs`
// (the runner Worker site/ready-runner starts the container from it); a night still running past its end is finished (its unfilled jobs are "failed: timeout"), its cost reported and its tabs closed.
// Nothing starts without the Queue binding (not created until the owner says so) or while READY_TO_SEND is off. Guard: site/test/ready-wiring.test.js.
import {closeNight} from './ready-morning.js';
import {readyOn, reportNight, start} from './ready.js';

export const SITE = 'https://www.jobpilotto.top', MAX_STARTS = 3;

// -> {started, finished}
export async function tick(env, now = new Date()) {
  const out = {started: 0, finished: 0};
  if (!readyOn(env) || !env.STATS) return out;
  const stamp = now.toISOString();
  const {results: over} = await env.STATS.prepare("SELECT * FROM ready_batches WHERE state IN ('running', 'capped') AND expires_at < ?").bind(stamp).all();
  for (const row of over) {
    await env.STATS.prepare("UPDATE ready_jobs SET state = 'failed', wall = 'timeout', at = ? WHERE batch = ? AND state = 'queued'").bind(stamp, row.id).run();
    await env.STATS.prepare("UPDATE ready_batches SET state = 'finished', finished_at = ? WHERE id = ?").bind(stamp, row.id).run();
    if (row.state === 'running') await reportNight(env, row, now);   // a capped night was reported when it was capped
    await closeNight(env, row.id);
    out.finished++;
  }
  if (!env.READY_QUEUE) return out;
  const {results: due} = await env.STATS.prepare("SELECT id FROM ready_batches WHERE state = 'queued' AND (fill_at IS NULL OR fill_at <= ?) ORDER BY created_at LIMIT ?").bind(stamp, MAX_STARTS).all();
  for (const row of due) {
    const token = await start(env, row.id, now);   // null when another tick took it
    if (!token) continue;
    await env.READY_QUEUE.send({batch: row.id, token, site: env.READY_SITE || SITE});
    out.started++;
  }
  return out;
}
