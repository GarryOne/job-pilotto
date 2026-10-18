// Ready to send, the morning's way to the held tabs (spec docs/superpowers/specs/2026-10-17-ready-to-send.md): the owner's calls for the live view, the hand-off and "what is held" go to the night's container through the runner Worker
// (service binding env.READY_RUNNER), carrying the night token the container was started with. Without the binding (not deployed yet) they answer 503 "not wired". Also the close: when a night has nothing left, its tabs are closed.
// The night token is derived from the batch id (a Worker secret), never stored. Guard: site/test/ready-wiring.test.js, ready-to-send.test.js (the kept hand-off).
import {tokenFor} from './guard.js';
import {keptGet} from './ready-kept.js';

export const readyToken = async (env, id) => `RR1.${id}.${await tokenFor(id, env, 'ready-run')}`;
const PATHS = {live: 'live', handoff: 'handoff', held: 'held'};   // what the owner asks -> what the runner Worker exposes
const unwired = () => Response.json({ok: false, error: 'not wired: the runner Worker is not deployed'}, {status: 503});

// -> the batch (id) that holds this owner's job and whose container may still hold its tab.
async function holder(env, install, job) {
  return env.STATS.prepare(`SELECT b.id FROM ready_jobs j JOIN ready_batches b ON b.id = j.batch WHERE b.install = ? AND j.job = ? AND j.cleared_at IS NULL AND b.state IN ('running', 'finished', 'capped')
    ORDER BY b.created_at DESC LIMIT 1`).bind(install, job).first();
}

// sub: live | handoff | held (the owner's key was checked by the caller). The WebSocket upgrade of "live" passes through as it came.
// The hand-off is served from what the night kept first (src/ready-kept.js): it works after the container is gone (a deploy, its sleep) and wakes no container.
export async function morning(request, env, install, sub) {
  const job = new URL(request.url).searchParams.get('job') || '';
  if (sub === 'handoff') {
    const kept = await keptGet(env, install, 'handoff', job).catch(() => null);
    if (kept) return Response.json({ok: true, ...JSON.parse(new TextDecoder().decode(kept))}, {headers: {'cache-control': 'no-store'}});
  }
  const found = sub === 'held' ? await env.STATS.prepare("SELECT id FROM ready_batches WHERE install = ? AND state IN ('running', 'finished', 'capped') ORDER BY created_at DESC LIMIT 1").bind(install).first() : await holder(env, install, job);
  if (!found) return Response.json({ok: false, error: 'nothing held for this job'}, {status: 404});
  if (!env.READY_RUNNER) return unwired();
  const address = `https://runner/${PATHS[sub]}?batch=${found.id}&t=${encodeURIComponent(await readyToken(env, found.id))}&job=${encodeURIComponent(job)}`;
  const reply = await env.READY_RUNNER.fetch(new Request(address, request));
  if (reply.status === 101) return reply;   // the live view's WebSocket
  // The owner was checked above: a container that refuses the night token (401: a fresh one, any image), lacks the tab (404) or holds no night (410) no longer holds the form.
  if ([401, 404, 410].includes(reply.status)) return Response.json({ok: false, error: 'gone: the server no longer holds this form'}, {status: 410, headers: {'cache-control': 'no-store'}});
  const headers = new Headers(reply.headers); headers.set('cache-control', 'no-store');
  return new Response(reply.body, {status: reply.status, headers});
}

// A night with nothing left to hold: its container closes the tabs and its browser. Best effort; the container also sleeps by itself.
export async function closeNight(env, id) {
  if (!env.READY_RUNNER) return;
  await env.READY_RUNNER.fetch(new Request(`https://runner/close?batch=${id}&t=${encodeURIComponent(await readyToken(env, id))}`, {method: 'POST'})).catch(() => {});
}
