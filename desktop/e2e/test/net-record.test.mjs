// The network recorder's keep rules (lib/net-record.mjs): what a record may hold (never cookies, request headers or request bodies), beacons dropped,
// images blanked to their size, request bodies kept only as a key. Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bodyKey, echo, keepRecord, normUrl, recordable} from '../lib/net-record.mjs';

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
