// The keep rules of a network record, shared by the harness recorder (e2e/lib/net-record.mjs) and the product's "Report this form" (spec docs/superpowers/specs/2026-10-15-report-this-form.md):
// what a recorded page keeps (never cookies, request headers or request bodies; images blanked; beacons and media dropped). One copy, so a pool record and a person's report cannot drift.
// Guard: desktop/e2e/test/net-record.test.mjs.
import crypto from 'node:crypto';
import {normalise} from './ai/model-memo.js';

const LOOP = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;
export const recordable = url => /^https?:/.test(url) && !LOOP.test(url);
export const siteOf = host => host.split('.').slice(-2).join('.');   // prototype: the last two labels (the build: the public suffix list)
const NONCE = /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{8,}$/i;
export const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
export function normUrl(url) {
  const u = new URL(url), q = [...u.searchParams].map(([k, v]) => [k, NONCE.test(v) ? '<nonce>' : normalise(v)]).sort();
  return `${u.protocol}//${u.host}${normalise(u.pathname)}${q.length ? `?${q.map(([k, v]) => `${k}=${v}`).join('&')}` : ''}`;
}
// An image's size from its header (PNG, GIF, JPEG): -> {width, height} or null.
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return {width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)};
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'GIF') return {width: buf.readUInt16LE(6), height: buf.readUInt16LE(8)};
  if (buf[0] === 0xff && buf[1] === 0xd8) for (let i = 2; i + 9 < buf.length;) { const len = buf.readUInt16BE(i + 2); if (buf[i + 1] >= 0xc0 && buf[i + 1] <= 0xc3) return {height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7)}; i += 2 + len; }
  if (buf.length > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') return {width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff};
    if (chunk === 'VP8L') { const bits = buf.readUInt32LE(21); return {width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1}; }
    if (chunk === 'VP8X') return {width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1};
  }
  return null;
}

// A GET whose reply is code (JavaScript, CSS, a font) by its content type or its file name, with a body.
export const prefetchedCode = entry => entry.method === 'GET' && entry.size > 0 && entry.status >= 200 && entry.status < 300
  && (/javascript|ecmascript|text\/css|font\//i.test(entry.headers?.['content-type'] || '') || /\.(m?js|css|woff2?|ttf|otf)(\?|$)/i.test(new URL(entry.url).pathname));

// What is kept (§9-§11): beacons and pings the page cannot read are dropped (third-party no-cors, not a script/style/font/image/document); an image becomes a same-size
// empty SVG; media dropped. -> {entries, bodies, stats}
export const KEEP_HEADER = /^(content-type|location|access-control-.*)$/i;   // the only response headers a record holds
export function keepRecord({entries, bodies}) {
  const firstParty = new Set(entries.filter(entry => entry.type === 'document').map(entry => siteOf(new URL(entry.url).host)));
  const kept = new Map(), out = [], stats = {requests: entries.length, rawBytes: 0, keptBytes: 0, dropped: {}, blanked: 0};
  const drop = (entry, why) => { stats.dropped[why] = (stats.dropped[why] || 0) + 1; out.push({...entry, dropped: why, hash: ''}); };
  for (const entry of entries) {
    stats.rawBytes += entry.size;
    const third = !firstParty.has(siteOf(new URL(entry.url).host));
    // A prefetch of the page's own code (<link rel=prefetch>: type "other", no-cors) is not a beacon: the page later runs it from the prefetch cache, so no second request
    // is recorded (Starling, 14 Oct 2026: 25 Workable chunks dropped, then served 404 on the replay; the phone widget stayed on +1 where live showed +41).
    if (third && (entry.type === 'ping' || entry.mode === 'no-cors') && !['script', 'stylesheet', 'font', 'image', 'document'].includes(entry.type) && !prefetchedCode(entry)) { drop(entry, 'beacon'); continue; }
    if (entry.type === 'media') { drop(entry, 'media'); continue; }
    let body = bodies.get(entry.hash), headers = entry.headers;
    // An image is blanked only when its size is known: a format this cannot measure (AVIF, SVG, a CDN's own) is kept whole, else a 40 px logo became 1 px
    // and the form's frame came out shorter (13 Oct 2026, a pool row's embedded form: every image answered as WebP/AVIF whatever its address said).
    const size = entry.type === 'image' && body ? imageSize(body) : null;
    if (size) {
      body = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"/>`); headers = {...headers, 'content-type': 'image/svg+xml'}; stats.blanked += 1;
    }
    const hash = body ? sha(body) : '';
    if (body && !kept.has(hash)) { kept.set(hash, body); stats.keptBytes += body.length; }
    out.push({...entry, headers, hash});
  }
  return {entries: out, bodies: kept, stats};
}
