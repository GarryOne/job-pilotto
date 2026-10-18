// Ready to send's "Watch the fill" (owner, 18 Oct 2026: a video for every form the night opens, kept on our server, encrypted): the night's container PUTs each form's
// video with its night token; it is sealed with READY_KEK beside the batch (ready/<install>/video/<batch>/<job>.webm), so "Delete everything" removes it with the rest;
// it is deleted with the job's data (Done, the 24-hour sweep), never kept past 7 days; only the owner reads it back. Guard: site/test/ready-video.test.js.
import {open, seal} from './hosted-state.js';

export const VIDEO_MAX_BYTES = 25 * 1024 * 1024, VIDEO_MAX_SECS = 180, VIDEO_KEEP_DAYS = 7;
const DAY = 86400000;
export const videoPrefix = (install, batch) => `ready/${install}/video/${batch}/`;
export const videoKey = (install, batch, job) => `${videoPrefix(install, batch)}${encodeURIComponent(job)}.webm`;
const label = install => `ready:${install}`;
const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});

// PUT /api/ready/video?job=&secs= (the night token's batch `row`): one job of that batch, its video as the body.
export async function videoPut(request, env, row, now = new Date()) {
  const url = new URL(request.url), job = url.searchParams.get('job') || '', secs = Number(url.searchParams.get('secs'));
  if (!/^[\w.:-]{1,64}$/.test(job)) return json({ok: false, error: 'bad job'}, 400);
  if ((request.headers.get('content-type') || '').split(';')[0].trim() !== 'video/webm') return json({ok: false, error: 'a webm video is required'}, 400);
  if (!Number.isInteger(secs) || secs < 1 || secs > VIDEO_MAX_SECS) return json({ok: false, error: `secs is 1 to ${VIDEO_MAX_SECS}`}, 400);
  if (Number(request.headers.get('content-length')) > VIDEO_MAX_BYTES) return json({ok: false, error: 'too large'}, 413);
  const mine = await env.STATS.prepare('SELECT 1 AS ok FROM ready_jobs WHERE batch = ? AND job = ? AND cleared_at IS NULL').bind(row.id, job).first();
  if (!mine) return json({ok: false, error: 'unknown job'}, 404);
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.byteLength) return json({ok: false, error: 'empty'}, 400);
  if (body.byteLength > VIDEO_MAX_BYTES) return json({ok: false, error: 'too large'}, 413);
  await env.HOSTED_STATE.put(videoKey(row.install, row.id, job), await seal(env, label(row.install), body, 'READY_KEK'), {customMetadata: {secs: String(secs), at: now.toISOString()}});
  return json({ok: true, bytes: body.byteLength});
}

// GET /api/ready/video?job= (the owner): the video of that job in his latest batch that still holds it.
export async function videoGet(request, env, install) {
  const job = new URL(request.url).searchParams.get('job') || '';
  if (!/^[\w.:-]{1,64}$/.test(job)) return json({ok: false, error: 'bad job'}, 400);
  const found = await env.STATS.prepare('SELECT b.id FROM ready_jobs j JOIN ready_batches b ON b.id = j.batch WHERE b.install = ? AND j.job = ? AND j.cleared_at IS NULL ORDER BY b.created_at DESC LIMIT 1').bind(install, job).first();
  const object = found && await env.HOSTED_STATE.get(videoKey(install, found.id, job));
  if (!object) return json({ok: false, error: 'no video for this form'}, 404);
  const bytes = await open(env, label(install), new Uint8Array(await object.arrayBuffer()), 'READY_KEK');
  return new Response(bytes, {headers: {'Content-Type': 'video/webm', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'no-store'}});
}

// The jobs of a batch that have a video (the card shows "Watch the fill" for them). -> Set of job ids.
export async function jobsWithVideo(env, install, batch) {
  const out = new Set();
  let cursor;
  do {
    const page = await env.HOSTED_STATE.list({prefix: videoPrefix(install, batch), cursor});
    for (const object of page.objects || []) out.add(decodeURIComponent(object.key.slice(videoPrefix(install, batch).length).replace(/\.webm$/, '')));
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  return out;
}

// Deletes the listed jobs' videos of a batch (all of them when `jobs` is null), and any of this install's videos older than 7 days.
export async function dropVideos(env, install, batch, jobs, now = new Date()) {
  const keys = jobs ? jobs.map(job => videoKey(install, batch, job)) : [...await jobsWithVideo(env, install, batch)].map(job => videoKey(install, batch, job));
  let cursor;
  do {
    const page = await env.HOSTED_STATE.list({prefix: `ready/${install}/video/`, cursor});
    for (const object of page.objects || []) if (now.getTime() - new Date(object.uploaded).getTime() > VIDEO_KEEP_DAYS * DAY) keys.push(object.key);
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  if (keys.length) await env.HOSTED_STATE.delete([...new Set(keys)]);
  return keys.length;
}
