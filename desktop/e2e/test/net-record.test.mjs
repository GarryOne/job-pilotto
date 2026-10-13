// The network recorder's keep rules (lib/net-record.mjs): what a record may hold (never cookies, request headers or request bodies), beacons dropped,
// images blanked to their size, request bodies kept only as a key. Pure: no browser.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bodyKey, keepRecord, normUrl, recordable} from '../lib/net-record.mjs';

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
