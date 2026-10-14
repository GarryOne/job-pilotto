// The network recorder's keep rules (lib/net-record.mjs): what a record may hold (never cookies, request headers or request bodies), beacons dropped,
// images blanked to their size, request bodies kept only as a key. Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {seedRandom, sequence} from '../lib/seeded-random.mjs';
import {bodyKey, echo, headerText, keepRecord, netRecorder, normUrl, prefetchedCode, recordable} from '../lib/net-record.mjs';

const png = (width, height) => { const buf = Buffer.alloc(33); buf.writeUInt32BE(0x89504e47, 0); buf.writeUInt32BE(width, 16); buf.writeUInt32BE(height, 20); return buf; };
const entry = (over = {}) => ({method: 'GET', url: 'https://jobs.example.test/apply', type: 'document', mode: 'navigate', startMs: 0, waitMs: 10, bodyKey: '', status: 200, failed: false, headers: {'content-type': 'text/html'}, hadCookie: false, hash: 'h1', size: 3, ...over});

test('a record keeps only the allowed response headers, never cookies; a beacon is dropped; an image becomes an empty SVG of its size', () => {
  const bodies = new Map([['h1', Buffer.from('abc')], ['img', png(120, 40)], ['b', Buffer.from('1')]]);
  const {entries, bodies: kept, stats} = keepRecord({bodies, entries: [
    entry(),
    entry({url: 'https://cdn.example.test/logo.png', type: 'image', hash: 'img', size: 33, headers: {'content-type': 'image/png'}}),
    entry({url: 'https://track.other.test/collect', type: 'ping', mode: 'no-cors', hash: 'b', size: 1}),
  ]});
  assert.equal(stats.dropped.beacon, 1);
  assert.equal(entries.find(one => one.type === 'ping').hash, '', 'a dropped beacon keeps no body');
  const image = entries.find(one => one.type === 'image');
  assert.equal(image.headers['content-type'], 'image/svg+xml');
  assert.match(kept.get(image.hash).toString(), /width="120" height="40"/);
  for (const one of entries) assert.ok(Object.keys(one.headers).every(name => /^(content-type|location|access-control-.*)$/i.test(name)), JSON.stringify(one.headers));
});

test('a request body is kept only as a key: a file part by its hash, text parts normalised, never the bytes', () => {
  const body = Buffer.from('--B\r\nContent-Disposition: form-data; name="key"\r\n\r\nstash/1791920360939-cnuf6fdhlre\r\n--B\r\nContent-Disposition: form-data; name="file"; filename="cv.pdf"\r\n\r\n%PDF-1.4 secret\r\n--B--\r\n');
  const key = bodyKey(body, 'multipart/form-data; boundary=B');
  assert.match(key, /^multi:key=.*&file=file:[0-9a-f]{16}$/);
  assert.ok(!key.includes('secret') && !key.includes('%PDF'), key);
  assert.equal(bodyKey(Buffer.from(''), 'text/plain'), '');
});

test('the app on this computer is never recorded; per-run values in an address are normalised', () => {
  assert.equal(recordable('http://127.0.0.1:4100/extension/me'), false);
  assert.equal(recordable('https://jobs.example.test/'), true);
  assert.equal(normUrl('https://a.test/x?session=ab12cd34ef&lang=en'), normUrl('https://a.test/x?lang=en&session=zz99yy88xx'));
});

test('an image of a format whose size is unknown is kept whole; a WebP is blanked at its own size', () => {
  const webp = Buffer.alloc(40); webp.write('RIFF', 0, 'latin1'); webp.write('WEBP', 8, 'latin1'); webp.write('VP8X', 12, 'latin1'); webp.writeUIntLE(319, 24, 3); webp.writeUIntLE(39, 27, 3);
  const avif = Buffer.from('\0\0\0 ftypavif-made-up-bytes');
  const {entries, bodies} = keepRecord({bodies: new Map([['w', webp], ['a', avif]]), entries: [
    entry({url: 'https://cdn.example.test/flags.webp', type: 'image', hash: 'w', size: 40}),
    entry({url: 'https://cdn.example.test/logo.png', type: 'image', hash: 'a', size: avif.length, headers: {'content-type': 'image/avif'}}),
  ]});
  assert.match(bodies.get(entries[0].hash).toString(), /width="320" height="40"/);
  assert.deepEqual(bodies.get(entries[1].hash), avif, 'an unmeasured image keeps its own bytes (a 1 px stand-in shrank a form by 40 px)');
  assert.equal(entries[1].headers['content-type'], 'image/avif');
});

test('a recorded reply that echoes the page\'s time+random upload key gets the key this replay sent, plain and URL-encoded', () => {
  const reply = Buffer.from('<Location>https://store.test/stash%2Fr%2F1791920360939-cnuf6fdhlre-07ea</Location><Key>stash/r/1791920360939-cnuf6fdhlre-07ea</Key>');
  const out = echo(reply, ['stash/r/1791920362778-zzp4hhc0ymk-07ea', 'UTF8']).toString();
  assert.match(out, /<Key>stash\/r\/1791920362778-zzp4hhc0ymk-07ea<\/Key>/);
  assert.match(out, /stash%2Fr%2F1791920362778-zzp4hhc0ymk-07ea/);
  assert.equal(echo(reply, ['short-1']), reply, 'a short or plain value is never swapped');
});

test('the page draws the same random numbers from the same seed, in [0, 1); no seed sets nothing', async () => {
  const a = sequence(1791920352178 % 4294967296), b = sequence(1791920352178 % 4294967296), draws = Array.from({length: 5}, a);
  assert.deepEqual(draws, Array.from({length: 5}, b));
  assert.ok(draws.every(x => x >= 0 && x < 1) && new Set(draws).size === 5);
  let added = null;
  assert.equal(await seedRandom({addInitScript: async (fn, arg) => { added = arg; }}, 1791920352178), true);
  assert.equal(added, 1791920352178 % 4294967296);
  assert.equal(await seedRandom({addInitScript: async () => { throw new Error('never'); }}, undefined), false);
});

test('a request reported failed after its reply came keeps that reply (an upload the page stopped reading); one with no reply is failed', async () => {
  const {EventEmitter} = await import('node:events');
  const context = new EventEmitter(), rec = netRecorder(context, {startedAt: 0});
  const request = (url, response) => ({url: () => url, method: () => 'POST', resourceType: () => 'fetch', postDataBuffer: () => null, allHeaders: async () => ({}), headers: () => ({}),
    response: async () => response, failure: () => ({errorText: 'net::ERR_ABORTED'})});
  const reply = {status: () => 204, body: async () => { throw new Error('no body'); }, allHeaders: async () => ({'access-control-allow-origin': '*'}), headers: () => ({})};
  for (const req of [request('https://files.example.test/', reply), request('https://files.example.test/none', null)]) { context.emit('request', req); context.emit('requestfailed', req); }
  await rec.flush();
  const [kept, lost] = rec.result().entries.sort((a, b) => a.url.localeCompare(b.url));
  assert.equal(kept.status, 204);
  assert.equal(kept.failed, false, 'a reply that came is replayed as that reply');
  assert.equal(kept.error, 'net::ERR_ABORTED');
  assert.equal(lost.failed, true);
  assert.equal(lost.status, 0);
});

test('a third-party prefetch of code is kept (the page runs it from the prefetch cache); a real ping is still dropped', () => {
  const doc = {method: 'GET', url: 'https://apply.jobs.test/j/1', type: 'document', mode: 'navigate', status: 200, size: 3, hash: 'd', headers: {'content-type': 'text/html'}};
  const chunk = {method: 'GET', url: 'https://cdn.other.test/releases/job.abc.chunk.js', type: 'other', mode: 'no-cors', status: 200, size: 9, hash: 'c', headers: {'content-type': 'application/javascript'}};
  const ping = {method: 'POST', url: 'https://bat.bing.test/action', type: 'ping', mode: 'no-cors', status: 204, size: 0, hash: '', headers: {}};
  const gif = {method: 'GET', url: 'https://ads.other.test/conv;id=1', type: 'fetch', mode: 'no-cors', status: 200, size: 43, hash: 'g', headers: {'content-type': 'image/gif'}};
  assert.equal(prefetchedCode(chunk), true);
  assert.equal(prefetchedCode({...chunk, headers: {}, url: 'https://cdn.other.test/x.css?v=2'}), true, 'by its file name when no content type was kept');
  assert.equal(prefetchedCode(ping), false);
  assert.equal(prefetchedCode(gif), false);
  const {entries} = keepRecord({entries: [doc, chunk, ping, gif], bodies: new Map([['d', Buffer.from('<p>')], ['c', Buffer.from('let a = 1;')], ['g', Buffer.from('GIF89a')]])});
  const by = Object.fromEntries(entries.map(entry => [entry.url, entry.dropped || 'kept']));
  assert.equal(by[chunk.url], 'kept', 'Starling, 14 Oct 2026: 25 Workable chunks dropped, then 404 on the replay');
  assert.equal(by[ping.url], 'beacon');
  assert.equal(by[gif.url], 'beacon');
});

test('a redirect sent as raw UTF-8 is handed back as the browser read it, not double-encoded (Breitling, 14 Oct 2026)', () => {
  // The recorder reads header bytes as Latin-1: "Genève" arrives as "GenÃ¨ve"; the live browser followed /Genève/ (%C3%A8).
  assert.equal(headerText('/job/Geneva-Universal-GenÃ¨ve-Grand-Vendeur/1432-en_GB/'), '/job/Geneva-Universal-Genève-Grand-Vendeur/1432-en_GB/');
  assert.equal(new URL(headerText('/job/GenÃ¨ve/'), 'https://careers.example.com/').pathname, '/job/Gen%C3%A8ve/');
  assert.equal(headerText('/job/plain-ascii/?a=1'), '/job/plain-ascii/?a=1', 'ASCII untouched');
  assert.equal(headerText('/café'), '/café', 'a lone Latin-1 byte that is not UTF-8 is kept as it was');
  assert.equal(headerText('/already/Genève'), '/already/Genève', 'a real character above Latin-1 is never re-read');
  assert.equal(headerText(undefined), '');
});
