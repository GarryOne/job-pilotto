// Fill again (owner, 18 Oct 2026: "a button per row with fill again"; then "it doesn't work... it doesn't finish the job": the app looked the job up in its own list,
// where an opened job no longer counts as finished): one form of a night is filled again from the night's own sealed copy, never from the app's list. Its row is queued
// again, its old video and hand-off go, the night's container is closed (a container fills a night once) and the night starts again; the container reads only the rows
// still queued (ready.js, the batch GET), so the other forms keep their results and kept hand-offs. Guard: site/test/ready-again.test.js.
import {dropKept} from './ready-kept.js';
import {closeNight} from './ready-morning.js';
import {startBatch} from './ready-tick.js';

export const GONE = 'gone: the server no longer holds this form';

// -> {status, body}
export async function fillAgain(env, install, job, now = new Date()) {
  if (!env.READY_QUEUE) return {status: 503, body: {ok: false, error: 'not wired: the Queue is not set up'}};
  const row = await env.STATS.prepare('SELECT b.id, b.state FROM ready_batches b JOIN ready_jobs j ON j.batch = b.id WHERE b.install = ? AND j.job = ? AND j.cleared_at IS NULL ORDER BY b.created_at DESC LIMIT 1')
    .bind(install, job).first();
  if (!row || !['queued', 'finished'].includes(row.state)) {
    if (row?.state === 'running') return {status: 409, body: {ok: false, error: 'already started'}};
    if (row?.state === 'capped') return {status: 409, body: {ok: false, error: 'capped: this night reached its spending limit'}};
    return {status: 410, body: {ok: false, error: GONE}};
  }
  await closeNight(env, row.id);
  await dropKept(env, install, row.id, [job], now).catch(() => {});
  await env.STATS.batch([
    env.STATS.prepare("UPDATE ready_jobs SET state = 'queued', filled = NULL, left_empty = NULL, human_check = NULL, wall = NULL, ms = NULL, at = NULL WHERE batch = ? AND job = ?").bind(row.id, job),
    env.STATS.prepare("UPDATE ready_batches SET state = 'queued', finished_at = NULL WHERE id = ?").bind(row.id)]);
  return startBatch(env, row.id, now);
}
