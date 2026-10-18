// What Ready to send keeps of each filled form after the night, sealed with READY_KEK beside the batch (ready/<install>/<kind>/<batch>/<job>), so "Delete everything" removes it with the rest:
//  - video:   Watch the fill (owner, 18 Oct 2026: a video for every form the night opens, kept on our server);
//  - handoff: what "Open in my browser" needs (the page, the site's cookies and storage, the filled values), so it works after the night's container is gone
//             (owner, 18 Oct 2026: "Yes, sealed, 24 h max"; deploys and the container's sleep drop its held tabs).
// The night's container PUTs each with its night token; only the owner reads it back; it is deleted with the form's data (Done, the 24-hour sweep, Delete everything)
// and never kept past its kind's age, whatever else happens. Never logged. Guard: site/test/ready-to-send.test.js.
import {open, seal} from './hosted-state.js';

const DAY = 86400000;
export const KINDS = {
  video: {ext: 'webm', type: 'video/webm', max: 25 * 1024 * 1024, keepMs: 7 * DAY},
  handoff: {ext: 'json', type: 'application/json', max: 2 * 1024 * 1024, keepMs: DAY},
};
export const VIDEO_MAX_SECS = 180;
export const keptPrefix = (install, kind, batch) => `ready/${install}/${kind}/${batch}/`;
export const keptKey = (install, kind, batch, job) => `${keptPrefix(install, kind, batch)}${encodeURIComponent(job)}.${KINDS[kind].ext}`;
const label = install => `ready:${install}`;
const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
const goodJob = job => /^[\w.:-]{1,64}$/.test(job);

// PUT /api/ready/<kind>?job=[&secs=] (the night token's batch `row`): one job of that batch, the body as given.
export async function keptPut(request, env, row, kind, now = new Date()) {
  const spec = KINDS[kind], url = new URL(request.url), job = url.searchParams.get('job') || '', secs = Number(url.searchParams.get('secs'));
  if (!goodJob(job)) return json({ok: false, error: 'bad job'}, 400);
  if ((request.headers.get('content-type') || '').split(';')[0].trim() !== spec.type) return json({ok: false, error: `${spec.type} is required`}, 400);
  if (kind === 'video' && (!Number.isInteger(secs) || secs < 1 || secs > VIDEO_MAX_SECS)) return json({ok: false, error: `secs is 1 to ${VIDEO_MAX_SECS}`}, 400);
  if (Number(request.headers.get('content-length')) > spec.max) return json({ok: false, error: 'too large'}, 413);
  const mine = await env.STATS.prepare('SELECT 1 AS ok FROM ready_jobs WHERE batch = ? AND job = ? AND cleared_at IS NULL').bind(row.id, job).first();
  if (!mine) return json({ok: false, error: 'unknown job'}, 404);
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.byteLength) return json({ok: false, error: 'empty'}, 400);
  if (body.byteLength > spec.max) return json({ok: false, error: 'too large'}, 413);
  if (kind === 'handoff') {   // a page address the browser can open, or nothing is kept
    let given = null; try { given = JSON.parse(new TextDecoder().decode(body)); } catch { /* not JSON */ }
    if (!/^https?:\/\/\S+$/.test(String(given?.url || ''))) return json({ok: false, error: 'a hand-off needs its page address'}, 400);
  }
  await env.HOSTED_STATE.put(keptKey(row.install, kind, row.id, job), await seal(env, label(row.install), body, 'READY_KEK'), {customMetadata: {at: now.toISOString(), ...(kind === 'video' ? {secs: String(secs)} : {})}});
  return json({ok: true, bytes: body.byteLength});
}

// The owner's: the kept bytes of that job in his latest batch that still holds it, opened. -> Uint8Array or null.
export async function keptGet(env, install, kind, job) {
  if (!goodJob(job)) return null;
  const found = await env.STATS.prepare('SELECT b.id FROM ready_jobs j JOIN ready_batches b ON b.id = j.batch WHERE b.install = ? AND j.job = ? AND j.cleared_at IS NULL ORDER BY b.created_at DESC LIMIT 1').bind(install, job).first();
  const object = found && await env.HOSTED_STATE.get(keptKey(install, kind, found.id, job));
  return object ? open(env, label(install), new Uint8Array(await object.arrayBuffer()), 'READY_KEK') : null;
}

// GET /api/ready/video?job= (the owner).
export async function videoGet(request, env, install) {
  const bytes = await keptGet(env, install, 'video', new URL(request.url).searchParams.get('job') || '');
  return bytes ? new Response(bytes, {headers: {'Content-Type': 'video/webm', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'no-store'}}) : json({ok: false, error: 'no video for this form'}, 404);
}

async function listed(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.HOSTED_STATE.list({prefix, cursor});
    out.push(...(page.objects || []));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return out;
}

// The jobs of a batch that have this kind kept (the card shows "Watch the fill" for a video). -> Set of job ids.
export async function jobsWithKept(env, install, kind, batch) {
  const prefix = keptPrefix(install, kind, batch), ext = `.${KINDS[kind].ext}`;
  return new Set((await listed(env, prefix)).map(object => decodeURIComponent(object.key.slice(prefix.length, -ext.length))));
}

// Deletes what is kept of the listed jobs of a batch (all of them when `jobs` is null), and anything of this install older than its kind's age. -> how many objects.
export async function dropKept(env, install, batch, jobs, now = new Date()) {
  const keys = [];
  for (const kind of Object.keys(KINDS)) {
    if (jobs) keys.push(...jobs.map(job => keptKey(install, kind, batch, job)));
    else keys.push(...(await listed(env, keptPrefix(install, kind, batch))).map(object => object.key));
    for (const object of await listed(env, `ready/${install}/${kind}/`)) if (now.getTime() - new Date(object.uploaded).getTime() > KINDS[kind].keepMs) keys.push(object.key);
  }
  if (keys.length) await env.HOSTED_STATE.delete([...new Set(keys)]);
  return keys.length;
}
