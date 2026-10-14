// The network recorder and replayer of a live row (spec docs/superpowers/specs/2026-10-13-replay-by-network.md): the recorder keeps every response the browser
// got (never cookies, request headers or request bodies); the replayer serves it back by the spec's rules. Guard: e2e/test/net-record.test.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import {normalise} from '../../lib/ai/model-memo.js';

const LOOP = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;
export const recordable = url => /^https?:/.test(url) && !LOOP.test(url);
const pathOf = url => { const u = new URL(url); return `${u.protocol}//${u.host}${normalise(u.pathname)}`; };
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
// A header the site sent as raw UTF-8 bytes (a redirect to ".../Genève/...") reaches the recorder read as Latin-1 ("GenÃ¨ve"); the live browser read
// the bytes as UTF-8. The replay hands them back the browser's way, or it follows a double-encoded address that was never recorded (14 Oct 2026,
// Breitling: the fill never started). A value that is not valid UTF-8 that way is kept as it is. -> string
export const headerText = value => { const text = String(value ?? ''); if (!/[\u0080-\u00ff]/.test(text) || /[^\u0000-\u00ff]/.test(text)) return text;
  const utf8 = Buffer.from(text, 'latin1').toString('utf8'); return utf8.includes('\ufffd') ? text : utf8; };

// The live side. -> {flush(), result(): {entries, bodies}}
export function netRecorder(context, {startedAt = Date.now()} = {}) {
  const entries = [], bodies = new Map(), t0 = new Map(), pending = new Set();
  context.on('request', request => { if (recordable(request.url())) t0.set(request, Date.now()); });
  const done = async (request, failed) => {
    if (!recordable(request.url())) return;
    // A request reported failed AFTER its reply came (the page stopped reading it, e.g. a CV upload to storage: Ashby, 14 Oct 2026) keeps that reply: replayed as failed, the
    // site shows "failed to upload" where live went on. Only a request with no reply at all is replayed as failed.
    const began = t0.get(request) ?? Date.now(), ended = Date.now(), response = await request.response().catch(() => null);
    let body = null;
    try { body = response ? await response.body() : null; } catch { body = null; }
    const headers = response ? await response.allHeaders().catch(() => response.headers()) : {}, sent = await request.allHeaders().catch(() => request.headers());
    const hash = body ? sha(body) : '';
    if (body) bodies.set(hash, body);
    entries.push({method: request.method(), url: request.url(), type: request.resourceType(), mode: sent['sec-fetch-mode'] || '', startMs: began - startedAt, waitMs: ended - began,
      bodyKey: bodyKey(request.postDataBuffer(), sent['content-type'] || ''), status: response?.status() ?? 0, failed: !response, ...(failed ? {error: String(request.failure()?.errorText || '').slice(0, 80)} : {}),
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

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// The echo rule: a reply that echoes a per-run value the page sent (an upload key built from the time and a random number) gets the replay's own value in place of
// the live one. A value is per-run when it is long and mixes digits and letters; its live twin in the reply has the same shape (each run of letters/digits the same length,
// the same punctuation between). -> the reply body, rewritten when exactly one twin is found per value.
const parts = (buf, contentType) => {
  const boundary = /boundary=([^;]+)/i.exec(contentType || '')?.[1];
  if (!buf || !boundary) return [];
  return buf.toString('latin1').split(`--${boundary}`).slice(1, -1).map(part => { const at = part.indexOf('\r\n\r\n'), head = part.slice(0, at); return /filename="/.test(head) ? '' : part.slice(at + 4).replace(/\r\n$/, ''); }).filter(Boolean);
};
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function echo(body, sentValues) {
  let text = body.toString('utf8'), changed = 0;
  for (const value of sentValues) {
    if (value.length < 16 || !/\d/.test(value) || !/[a-z]/i.test(value) || text.includes(value)) continue;
    const shape = new RegExp(value.split(/([^A-Za-z0-9]+)/).map((run, i) => (i % 2 ? escape(run) : `[A-Za-z0-9]{${run.length}}`)).join(''), 'g');
    const twins = [...new Set(text.match(shape) || [])];
    if (twins.length !== 1) continue;
    for (const [from, to] of [[twins[0], value], [encodeURIComponent(twins[0]), encodeURIComponent(value)]]) if (text.includes(from)) { text = text.split(from).join(to); changed += 1; }
  }
  return changed ? Buffer.from(text) : body;
}
const netLog = line => { if (process.env.JP_NET_LOG) try { fs.appendFileSync(process.env.JP_NET_LOG, `${Date.now()} ${line}\n`); } catch { /* a report only */ } };
// The replay side (§2-§7): one route serves the record. -> {counts}
export async function netReplay(context, {entries, bodies}, {slow = false, say = () => {}} = {}) {
  const counts = {exact: 0, normalised: 0, order: 0, notRecorded: [], thirdPartyMisses: 0, sockets: 0, dropped: 0};
  const firstParty = new Set(entries.filter(entry => entry.type === 'document').map(entry => siteOf(new URL(entry.url).host)));
  const group = keyOf => { const map = new Map(); for (const entry of entries) { const key = keyOf(entry); if (!map.has(key)) map.set(key, []); map.get(key).push(entry); } return map; };
  const byExact = group(entry => `${entry.method} ${entry.url} ${entry.bodyKey}`), byNorm = group(entry => `${entry.method} ${normUrl(entry.url)} ${entry.bodyKey}`), byPath = group(entry => `${entry.method} ${pathOf(entry.url)}`);
  const used = new Set();
  const take = (list, method) => { if (!list?.length) return null; const next = list.find(entry => !used.has(entry)); if (next) { used.add(next); return next; } return method === 'GET' ? list.at(-1) : null; };
  await context.routeWebSocket(/.*/, ws => { counts.sockets += 1; ws.close(); });
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (!recordable(url)) return route.continue();
    const method = request.method(), sent0 = await request.allHeaders().catch(() => request.headers()), key = bodyKey(request.postDataBuffer(), sent0['content-type'] || '');
    if (process.env.JP_NET_LOG && method !== 'GET') { const raw = (request.postDataBuffer() || Buffer.alloc(0)).toString('latin1'); netLog(`body ${method} ${url.slice(0, 80)}: ${(raw.match(/name="key"\r\n\r\n[^\r]*/) || [''])[0].replace(/\r\n/g, ' ')}`); }
    let entry = take(byExact.get(`${method} ${url} ${key}`), method), rule = 'exact';
    if (!entry) { entry = take(byNorm.get(`${method} ${normUrl(url)} ${key}`), method); rule = 'normalised'; }
    if (!entry) { entry = take(byPath.get(`${method} ${pathOf(url)}`), method); rule = 'order'; }
    if (!entry) {
      const first = firstParty.has(siteOf(new URL(url).host)) && ['document', 'script', 'fetch', 'xhr'].includes(request.resourceType());
      if (first) counts.notRecorded.push(`${method} ${pathOf(url)} (${request.resourceType()})`); else counts.thirdPartyMisses += 1;
      netLog(`404 ${method} ${url.slice(0, 160)} key=${key.slice(0, 40)} type=${request.resourceType()}`);
      return route.fulfill({status: 404, body: ''});
    }
    counts[rule] += 1;
    netLog(`${rule} ${method} ${url.slice(0, 160)} key=${key.slice(0, 40)} -> ${entry.status}${entry.failed ? ' failed' : ''} wait=${entry.waitMs} served=${entry.method} ${entry.url.slice(0, 160)} @${entry.startMs} hash=${(entry.hash || '').slice(0, 12)}`);
    if (rule === 'order') say(`loose: ${method} ${url} served the recording of ${entry.url}`);
    await wait(Math.min(8000, entry.waitMs) * (slow ? 1.6 : 1));
    if (entry.dropped) { counts.dropped += 1; return route.fulfill({status: 404, body: ''}); }
    if (entry.failed) return route.abort().catch(() => {});
    // A recorded redirect of a page load: Chromium does not follow a fulfilled 3xx on a navigation (the load fails, the page is loaded again), so it is
    // served as a page that moves on at once, keeping the address's #fragment (the fill mark) as a real redirect does.
    const to = entry.headers?.location ? headerText(entry.headers.location) : '';
    if (to && entry.status >= 300 && entry.status < 400 && request.isNavigationRequest()) {
      counts.redirects = (counts.redirects || 0) + 1;
      return route.fulfill({status: 200, contentType: 'text/html', body: `<!doctype html><script>location.replace(${JSON.stringify(new URL(to, url).href)} + location.hash)</script>`}).catch(() => {});
    }
    let body = bodies.get(entry.hash) || Buffer.alloc(0), headers = entry.headers?.location ? {...entry.headers, location: headerText(entry.headers.location)} : entry.headers;
    if (method !== 'GET' && body.length && body.length < 1e5) {
      const sent = parts(request.postDataBuffer(), sent0['content-type']), echoed = echo(body, sent);
      if (echoed !== body) { counts.echoed = (counts.echoed || 0) + 1; netLog(`echo ${method} ${url.slice(0, 80)}`); body = echoed; headers = Object.fromEntries(Object.entries(headers).map(([name, v]) => [name, echo(Buffer.from(String(v)), sent).toString()])); }
    }
    return route.fulfill({status: entry.status, headers, body}).catch(() => {});
  });
  return {counts};
}
