// The network recorder of a live row (spec docs/superpowers/specs/2026-10-13-replay-by-network.md): every response the browser got, never cookies, request
// headers or request bodies (a body is kept only as a key). keepRecord drops beacons, blanks images to same-size SVGs. Guard: e2e/test/net-record.test.mjs.
import crypto from 'node:crypto';
import {normalise} from '../../lib/ai/model-memo.js';

const LOOP = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;
export const recordable = url => /^https?:/.test(url) && !LOOP.test(url);
const siteOf = host => host.split('.').slice(-2).join('.');   // prototype: the last two labels (the build: the public suffix list)
const NONCE = /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{8,}$/i;
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
export function normUrl(url) {
  const u = new URL(url), q = [...u.searchParams].map(([k, v]) => [k, NONCE.test(v) ? '<nonce>' : normalise(v)]).sort();
  return `${u.protocol}//${u.host}${normalise(u.pathname)}${q.length ? `?${q.map(([k, v]) => `${k}=${v}`).join('&')}` : ''}`;
}
// The request body as a key, never the body: multipart parts by name (a file part by its bytes' hash, text normalised), a binary body by hash, text normalised.
export function bodyKey(buf, contentType = '') {
  if (!buf || !buf.length) return '';
  const boundary = /boundary=([^;]+)/i.exec(contentType)?.[1];
  if (boundary) {
    return 'multi:' + buf.toString('latin1').split(`--${boundary}`).slice(1, -1).map(part => {
      const at = part.indexOf('\r\n\r\n'), head = part.slice(0, at), body = part.slice(at + 4).replace(/\r\n$/, '');
      const name = /name="([^"]*)"/.exec(head)?.[1] || '';
      return /filename="/.test(head) ? `${name}=file:${sha(Buffer.from(body, 'latin1')).slice(0, 16)}` : `${name}=${normalise(body)}`;
    }).join('&');
  }
  if (buf.includes(0) || /octet-stream|pdf/.test(contentType)) return `bin:${sha(buf).slice(0, 16)}`;
  return `txt:${sha(normalise(buf.toString('utf8'))).slice(0, 16)}`;
}
const KEEP_HEADER = /^(content-type|location|access-control-.*)$/i;

// The live side. -> {flush(), result(): {entries, bodies}}
export function netRecorder(context, {startedAt = Date.now()} = {}) {
  const entries = [], bodies = new Map(), t0 = new Map(), pending = new Set();
  context.on('request', request => { if (recordable(request.url())) t0.set(request, Date.now()); });
  const done = async (request, failed) => {
    if (!recordable(request.url())) return;
    const began = t0.get(request) ?? Date.now(), ended = Date.now(), response = failed ? null : await request.response().catch(() => null);
    let body = null;
    try { body = response ? await response.body() : null; } catch { body = null; }
    const headers = response ? await response.allHeaders().catch(() => response.headers()) : {}, sent = await request.allHeaders().catch(() => request.headers());
    const hash = body ? sha(body) : '';
    if (body) bodies.set(hash, body);
    entries.push({method: request.method(), url: request.url(), type: request.resourceType(), mode: sent['sec-fetch-mode'] || '', startMs: began - startedAt, waitMs: ended - began,
      bodyKey: bodyKey(request.postDataBuffer(), sent['content-type'] || ''), status: response?.status() ?? 0, failed: !!failed || !response,
      headers: Object.fromEntries(Object.entries(headers).filter(([name]) => KEEP_HEADER.test(name))), hadCookie: 'set-cookie' in headers, hash, size: body?.length || 0});
  };
  const track = promise => { pending.add(promise); promise.finally(() => pending.delete(promise)); };
  context.on('requestfinished', request => track(done(request, false)));
  context.on('requestfailed', request => track(done(request, true)));
  return {flush: () => Promise.all([...pending]), result: () => ({entries: [...entries].sort((a, b) => a.startMs - b.startMs), bodies})};
}

// An image's size from its header (PNG, GIF, JPEG): -> {width, height} or null.
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return {width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)};
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'GIF') return {width: buf.readUInt16LE(6), height: buf.readUInt16LE(8)};
  if (buf[0] === 0xff && buf[1] === 0xd8) for (let i = 2; i + 9 < buf.length;) { const len = buf.readUInt16BE(i + 2); if (buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xc3) return {height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7)}; i += 2 + len; }
  return null;
}

// What is kept (§9-§11): beacons and pings the page cannot read are dropped (third-party no-cors, not a script/style/font/image/document); an image becomes a same-size
// empty SVG; media dropped. -> {entries, bodies, stats}
export function keepRecord({entries, bodies}) {
  const firstParty = new Set(entries.filter(entry => entry.type === 'document').map(entry => siteOf(new URL(entry.url).host)));
  const kept = new Map(), out = [], stats = {requests: entries.length, rawBytes: 0, keptBytes: 0, dropped: {}, blanked: 0};
  const drop = (entry, why) => { stats.dropped[why] = (stats.dropped[why] || 0) + 1; out.push({...entry, dropped: why, hash: ''}); };
  for (const entry of entries) {
    stats.rawBytes += entry.size;
    const third = !firstParty.has(siteOf(new URL(entry.url).host));
    if (third && (entry.type === 'ping' || entry.mode === 'no-cors') && !['script', 'stylesheet', 'font', 'image', 'document'].includes(entry.type)) { drop(entry, 'beacon'); continue; }
    if (entry.type === 'media') { drop(entry, 'media'); continue; }
    let body = bodies.get(entry.hash), headers = entry.headers;
    if (entry.type === 'image' && body) {
      const size = imageSize(body) || {width: 1, height: 1};
      body = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"/>`); headers = {...headers, 'content-type': 'image/svg+xml'}; stats.blanked += 1;
    }
    const hash = body ? sha(body) : '';
    if (body && !kept.has(hash)) { kept.set(hash, body); stats.keptBytes += body.length; }
    out.push({...entry, headers, hash});
  }
  return {entries: out, bodies: kept, stats};
}
