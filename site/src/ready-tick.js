// Ready to send, the cron side (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): on the existing 5-minute tick, a queued night whose fill time has come gets its night token and one message on the Queue `ready-runs`
// (the runner Worker site/ready-runner starts the container from it); a night still running past its end is finished (its unfilled jobs are "failed: timeout"), its cost reported and its tabs closed.
// Nothing starts without the Queue binding (not created until the owner says so) or while READY_TO_SEND is off. Guard: site/test/ready-wiring.test.js.
import {closeNight} from './ready-morning.js';
import {LIVE} from './ready-line.js';
import {readyOn, reportNight, start} from './ready.js';

export const SITE = 'https://www.jobadabra.top', MAX_STARTS = 3;

// -> {started, finished}
export async function tick(env, now = new Date()) {
  const out = {started: 0, finished: 0};
  if (!readyOn(env) || !env.STATS) return out;
  const stamp = now.toISOString();
  const {results: over} = await env.STATS.prepare("SELECT * FROM ready_batches WHERE state IN ('running', 'capped') AND expires_at < ?").bind(stamp).all();
  for (const row of over) {
    await env.STATS.prepare(`UPDATE ready_jobs SET state = 'failed', wall = 'timeout', at = ?, step = NULL, step_n = NULL WHERE batch = ? AND state IN ${LIVE}`).bind(stamp, row.id).run();
    await env.STATS.prepare("UPDATE ready_batches SET state = 'finished', finished_at = ? WHERE id = ?").bind(stamp, row.id).run();
    if (row.state === 'running') await reportNight(env, row, now);   // a capped night was reported when it was capped
    await closeNight(env, row.id);
    out.finished++;
  }
  if (!env.READY_QUEUE) return out;
  const {results: due} = await env.STATS.prepare("SELECT id FROM ready_batches WHERE state = 'queued' AND (fill_at IS NULL OR fill_at <= ?) ORDER BY created_at LIMIT ?").bind(stamp, MAX_STARTS).all();
  for (const row of due) {
    const sent = await dispatch(env, row.id, now);   // 'taken' when another tick took it; a Queue that refuses puts the night back to queued: the next tick tries again
    if (sent === 'sent') out.started++;
  }
  return out;
}

// The owner's "run it now" (a test, or a night he wants early): his latest queued night starts at once, as the cron would start it. -> {status, body}
export async function runNow(env, install, now = new Date()) {
  if (!env.READY_QUEUE) return {status: 503, body: {ok: false, error: 'not wired: the Queue is not set up'}};
  const row = await env.STATS.prepare("SELECT id FROM ready_batches WHERE install = ? AND state = 'queued' ORDER BY created_at DESC LIMIT 1").bind(install).first();
  if (!row) return {status: 404, body: {ok: false, error: 'no queued night to run'}};
  return startBatch(env, row.id, now);
}

// One queued night starts at once: its token and one message on the Queue (the caller checked READY_QUEUE). -> {status, body}
export async function startBatch(env, id, now = new Date()) {
  const sent = await dispatch(env, id, now);
  if (sent === 'taken') return {status: 409, body: {ok: false, error: 'already started'}};
  if (sent === 'refused') return {status: 502, body: {ok: false, error: 'the queue refused the night'}};
  return {status: 202, body: {ok: true, batch: id}};
}

// The night's token, then its one message. A message that cannot be sent must not leave the night "running" with nothing to start it (19 Oct 2026: forms sat on
// "waiting" for 2 h): it goes back to queued. -> 'sent' | 'taken' (already started) | 'refused' (the Queue threw).
async function dispatch(env, id, now) {
  const token = await start(env, id, now);
  if (!token) return 'taken';
  try { await env.READY_QUEUE.send({batch: id, token, site: env.READY_SITE || SITE}); } catch {
    await env.STATS.prepare("UPDATE ready_batches SET state = 'queued', expires_at = NULL WHERE id = ? AND state = 'running'").bind(id).run();
    return 'refused';
  }
  return 'sent';
}
