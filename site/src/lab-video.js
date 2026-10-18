// The Lab's fill videos (owner, 18 Oct 2026: "▶ Watch" on a pool row): CI's pool run uploads one short video of each row's fill (PUT /applying/video, Bearer REPLAYS_PUBLISH_KEY) into the
// private R2 bucket LAB_FILLS; the newest replaces the row's old one, anything older than 14 days is dropped on the next upload (no bucket rule to create by hand), and only the owner streams
// one (GET /admin/lab-form-filling/video?name=<row>, Range so the player scrubs; ?index lists name, time, length and size). A fake applicant on a held page, never Submit. Guard: test/lab-video.test.js.
import {equal} from './guard.js';
import {viewer} from './auth.js';

export const MAX_BYTES = 25 * 1024 * 1024, MAX_SECS = 180, KEEP_DAYS = 14;
const TYPES = {'video/webm': 'webm', 'video/mp4': 'mp4'};
const DAY = 86400000;
const no = (status, error) => new Response(JSON.stringify({ok: false, error}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});

// A row's name, as the Lab shows it; never an address. -> the name or null.
const nameOf = value => { const name = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120); return name && !/[?=@]|:\/\/|https?:/i.test(name) ? name : null; };

// The bucket key of a row's video: a hash of its name, so no name or site text is ever a path.
export async function keyOf(name) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name));
  return `fills/${[...new Uint8Array(digest)].slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('')}.webm`;
}

async function prune(bucket, now) {
  const old = [];
  let cursor;
  do {
    const page = await bucket.list({prefix: 'fills/', cursor});
    for (const object of page.objects) if (now.getTime() - new Date(object.uploaded).getTime() > KEEP_DAYS * DAY) old.push(object.key);
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  if (old.length) await bucket.delete(old);
}

// PUT /applying/video?name=<row>&secs=<n>: the raw video as the body. A wrong or missing key is a 404, as the other publish keys.
export async function videoIngest(request, env, now = new Date()) {
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(env.REPLAYS_PUBLISH_KEY && equal(given, env.REPLAYS_PUBLISH_KEY))) return new Response('Not found', {status: 404});
  if (!env.LAB_FILLS) return no(503, 'not configured');
  const url = new URL(request.url), name = nameOf(url.searchParams.get('name')), secs = Number(url.searchParams.get('secs'));
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!name) return no(400, 'a row name is required');
  if (!TYPES[type]) return no(400, 'a webm or mp4 video is required');
  if (!Number.isInteger(secs) || secs < 1 || secs > MAX_SECS) return no(400, `secs is 1 to ${MAX_SECS}`);
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return no(413, 'too large');
  const body = await request.arrayBuffer();
  if (!body.byteLength) return no(400, 'empty');
  if (body.byteLength > MAX_BYTES) return no(413, 'too large');
  await env.LAB_FILLS.put(await keyOf(name), body, {httpMetadata: {contentType: type}, customMetadata: {name, at: now.toISOString(), secs: String(secs), bytes: String(body.byteLength)}});
  await prune(env.LAB_FILLS, now).catch(() => {});   // the upload stays stored whatever the clean-up does
  return Response.json({ok: true, bytes: body.byteLength}, {headers: {'Cache-Control': 'no-store'}});
}

// GET /admin/lab-form-filling/video: ?index -> {videos: {<row name>: {at, secs, bytes}}}; ?name=<row> -> the video, whole or by Range. Signed out is a 404.
export async function videoView(request, env) {
  if (!await viewer(request, env) || !env.LAB_FILLS) return new Response('Not found', {status: 404});
  const url = new URL(request.url);
  if (url.searchParams.has('index')) {
    const videos = {};
    let cursor;
    do {
      const page = await env.LAB_FILLS.list({prefix: 'fills/', cursor, include: ['customMetadata']});
      for (const object of page.objects) { const m = object.customMetadata || {}; if (m.name) videos[m.name] = {at: m.at, secs: Number(m.secs), bytes: Number(m.bytes)}; }
      cursor = page.truncated ? page.cursor : null;
    } while (cursor);
    return Response.json({videos}, {headers: {'Cache-Control': 'no-store'}});
  }
  const name = nameOf(url.searchParams.get('name'));
  const head = name ? await env.LAB_FILLS.head(await keyOf(name)).catch(() => null) : null, size = Number(head?.size);
  if (!name || !head || !(size > 0)) return new Response('Not found', {status: 404});
  const headers = {'Content-Type': head?.httpMetadata?.contentType || 'video/webm', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store'};
  const asked = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (!asked) return new Response((await env.LAB_FILLS.get(await keyOf(name))).body, {headers: {...headers, 'Content-Length': String(size)}});
  let start = asked[1] === '' ? size - Number(asked[2]) : Number(asked[1]), end = asked[1] === '' || asked[2] === '' ? size - 1 : Math.min(Number(asked[2]), size - 1);
  if (!(start >= 0 && start < size && end >= start)) return new Response('Range not satisfiable', {status: 416, headers: {'Content-Range': `bytes */${size}`}});
  const part = await env.LAB_FILLS.get(await keyOf(name), {range: {offset: start, length: end - start + 1}});
  return new Response(part.body, {status: 206, headers: {...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1)}});
}
