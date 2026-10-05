// Recurring problems wait in D1 for the private repo's daily triage to take them (GET /api/triage, the owner's key), which files the
// issues there. Replaces the old push into the public repo's workflows: no token for a private repository on the website, and
// nothing about which sites or fields fail is published.
import {isOwner} from './stats.js';

const KINDS = {'fill-failure-intake.yml': 'report', 'telemetry-triage.yml': 'problems'};
const KEEP_DAYS = 30, MAX_BYTES = 64 * 1024;

// The same call shape as a GitHub dispatch (env, inputs, workflow), so callers don't change.
export async function queue(env, inputs, workflow, now = new Date()) {
  const kind = KINDS[workflow];
  if (!kind || !env.STATS) throw new Error(`nothing to queue for ${workflow}`);
  await env.STATS.prepare('INSERT INTO triage_queue (kind, payload, created_at) VALUES (?, ?, ?)')
    .bind(kind, JSON.stringify(inputs).slice(0, MAX_BYTES), now.toISOString()).run();
}
export const queued = workflow => workflow in KINDS;

// GET /api/triage -> the items not yet taken; POST /api/triage {ids} -> mark them taken. Old taken items are dropped.
export async function triage(request, env, now = new Date()) {
  if (!await isOwner(request, env) || !env.STATS) return new Response('Not found', {status: 404});
  if (request.method === 'GET') {
    const rows = (await env.STATS.prepare('SELECT id, kind, payload, created_at FROM triage_queue WHERE taken_at IS NULL ORDER BY id LIMIT 50').all()).results || [];
    return Response.json({items: rows.map(row => ({id: row.id, kind: row.kind, at: row.created_at, payload: JSON.parse(row.payload)}))}, {headers: {'Cache-Control': 'private, no-store'}});
  }
  if (request.method !== 'POST') return new Response('Method not allowed', {status: 405});
  const body = await request.json().catch(() => ({}));
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger).slice(0, 100);
  for (const id of ids) await env.STATS.prepare('UPDATE triage_queue SET taken_at = ? WHERE id = ? AND taken_at IS NULL').bind(now.toISOString(), id).run();
  await env.STATS.prepare('DELETE FROM triage_queue WHERE taken_at IS NOT NULL AND taken_at < ?')
    .bind(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString()).run();
  return Response.json({ok: true, taken: ids.length});
}
