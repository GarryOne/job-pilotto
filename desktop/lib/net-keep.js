// The keep rules of a network record, shared by the harness recorder (e2e/lib/net-record.mjs) and the product's "Report this form" (spec docs/superpowers/specs/2026-10-15-report-this-form.md):
// what a recorded page keeps (never request headers or request bodies; cookies only a first-party one a page script reads, recorded by the harness, never in a person's report; images blanked; beacons and media dropped). One copy, so a pool record and a person's report cannot drift.
// Guard: desktop/e2e/test/net-record.test.mjs.
import crypto from 'node:crypto';
import {normalise} from './ai/model-memo.js';

const LOOP = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;
export const recordable = url => /^https?:/.test(url) && !LOOP.test(url) && URL.canParse(url);   // an address the URL parser refuses cannot be kept or grouped by host
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

// A text reply with no charset in its Content-Type (or no Content-Type) reaches the recorder as Chrome's inspector read it, bytes taken as windows-1252 and re-encoded as UTF-8 (Aldi, 15 Oct 2026:
// a server-action reply held "dÃ©tail â€“", the replayed page title turned to mojibake where live read "détail –"). The real bytes are those characters mapped back through
// windows-1252, kept only when they are valid UTF-8 with non-ASCII in them (the image of a double encoding; a genuinely Latin-1 reply, a labeled one, a binary one and a clean
// one are left as they are; a second repair finds nothing). Shared by the recorder, the replay and the pre-publish check. -> Buffer (the same one when nothing changes)
const UNLABELED_TEXT = /^(text\/|application\/(json|[\w.+-]*\+json|javascript|x-javascript|ecmascript|xml|[\w.+-]*\+xml)\b)/i;
const CP1252 = new Map(Array.from({length: 256}, (_, byte) => [new TextDecoder('windows-1252').decode(Uint8Array.of(byte)), byte]));
const UTF8_STRICT = new TextDecoder('utf-8', {fatal: true});
export function repairUnlabeledText(body, contentType = '') {
  const type = String(contentType || '').trim();   // no Content-Type at all is unlabeled too (a server action's reply without one; 15 Oct 2026): binary stays safe, it is never valid UTF-8 that way
  if (!body?.length || (type && !UNLABELED_TEXT.test(type)) || /charset\s*=/i.test(type)) return body;
  const text = body.toString('utf8');
  if (!/[^\u0000-\u007f]/.test(text)) return body;
  const bytes = [];
  for (const char of text) { const byte = CP1252.get(char); if (byte === undefined) return body; bytes.push(byte); }
  const real = Buffer.from(bytes);
  try { UTF8_STRICT.decode(real); } catch { return body; }
  return /[^\u0000-\u007f]/.test(real.toString('utf8')) ? real : body;
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
    out.push({...entry, headers, hash, ...(third ? {cookies: undefined} : {})});
  }
  return {entries: out, bodies: kept, stats};
}
