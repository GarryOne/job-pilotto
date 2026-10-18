// The Lab's fill videos (src/lab-video.js): CI uploads one video per pool row (Bearer REPLAYS_PUBLISH_KEY), the newest replaces the row's old one, the owner streams it with Range,
// anything older than 14 days is dropped on the next upload, and every refusal (key, size, type, name, no bucket) is tested.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {KEEP_DAYS, MAX_BYTES, keyOf, videoIngest, videoView} from '../src/lab-video.js';

const KEY = 'k'.repeat(64);
const bucket = () => {
  const kept = new Map();
  return {kept,
    put: async (name, value, options) => { kept.set(name, {bytes: new Uint8Array(value), uploaded: options.uploaded || new Date(), ...options}); },
    delete: async names => { for (const name of [].concat(names)) kept.delete(name); },
    list: async () => ({objects: [...kept].map(([key, o]) => ({key, uploaded: o.uploaded, customMetadata: o.customMetadata})), truncated: false}),
    head: async name => { const o = kept.get(name); return o ? {size: o.bytes.length, httpMetadata: o.httpMetadata} : null; },
    get: async (name, {range} = {}) => { const o = kept.get(name); if (!o) return null;
      const offset = range?.offset ?? 0, length = range?.length ?? o.bytes.length - offset;
      return {body: o.bytes.slice(offset, offset + length), size: o.bytes.length, range: {offset, length}, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata}; }};
};
const env = (extra = {}) => ({LAB_FILLS: bucket(), REPLAYS_PUBLISH_KEY: KEY, STATS_API_KEY: 'owner-key', STATS_KEY: 'k', ...extra});
const put = (e, {name = 'Ashby form in an embedded app', secs = 72, size = 1000, type = 'video/webm', key = KEY, now = new Date('2026-10-18T10:00:00Z')} = {}) => videoIngest(
  new Request(`https://x.test/applying/video?name=${encodeURIComponent(name)}&secs=${secs}`, {method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': type}, body: new Uint8Array(size).fill(7)}), e, now);
const get = (e, query, headers = {}, auth = 'owner-key') => videoView(new Request(`https://x.test/admin/lab-form-filling/video${query}`, {headers: {...(auth ? {Authorization: `Bearer ${auth}`} : {}), ...headers}}), e);

test('only the publish key writes; no key, a wrong key or no bucket never stores a byte', async () => {
  const e = env();
  assert.equal((await put(e, {key: 'wrong'})).status, 404);
  assert.equal((await put(env({REPLAYS_PUBLISH_KEY: ''}))).status, 404);
  assert.equal((await put(env({LAB_FILLS: undefined}))).status, 503);
  assert.equal(e.LAB_FILLS.kept.size, 0);
});

test('refuses what is not a short video of a named row', async () => {
  const e = env();
  assert.equal((await put(e, {size: MAX_BYTES + 1})).status, 413);
  assert.equal((await put(e, {size: 0})).status, 400);
  assert.equal((await put(e, {type: 'text/html'})).status, 400);
  assert.equal((await put(e, {secs: 181})).status, 400);   // the recorder's hard cap is 3 minutes
  assert.equal((await put(e, {name: 'https://a.test/job?id=1'})).status, 400);   // a name never carries an address
  assert.equal((await put(e, {name: ''})).status, 400);
  assert.equal(e.LAB_FILLS.kept.size, 0);
});

test('the newest video replaces the row\'s old one; the index lists name, time, length and size only', async () => {
  const e = env();
  assert.equal((await put(e, {size: 500, now: new Date('2026-10-17T10:00:00Z')})).status, 200);
  assert.equal((await put(e, {size: 800, secs: 40})).status, 200);
  assert.equal(e.LAB_FILLS.kept.size, 1);
  const index = await (await get(e, '?index')).json();
  assert.deepEqual(index.videos['Ashby form in an embedded app'], {at: '2026-10-18T10:00:00.000Z', secs: 40, bytes: 800});
  assert.equal(await keyOf('a'), await keyOf('a'));
  assert.notEqual(await keyOf('a'), await keyOf('b'));
});

test('a video older than 14 days leaves with the next upload', async () => {
  const e = env();
  e.LAB_FILLS.kept.set('fills/old.webm', {bytes: new Uint8Array(3), uploaded: new Date('2026-10-01T00:00:00Z'), customMetadata: {name: 'gone', at: '2026-10-01T00:00:00Z', secs: '9', bytes: '3'}});
  assert.equal(KEEP_DAYS, 14);
  await put(e);
  assert.deepEqual([...e.LAB_FILLS.kept.keys()], [await keyOf('Ashby form in an embedded app')]);
});

test('only the owner streams a video, whole or by Range, so the player can scrub', async () => {
  const e = env();
  await put(e, {size: 1000});
  const q = `?name=${encodeURIComponent('Ashby form in an embedded app')}`;
  assert.equal((await get(e, q, {}, null)).status, 404);
  assert.equal((await get(e, q, {}, 'wrong')).status, 404);
  const whole = await get(e, q);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('Content-Type'), 'video/webm');
  assert.equal(whole.headers.get('Accept-Ranges'), 'bytes');
  assert.equal((await whole.arrayBuffer()).byteLength, 1000);
  const part = await get(e, q, {Range: 'bytes=100-199'});
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('Content-Range'), 'bytes 100-199/1000');
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const tail = await get(e, q, {Range: 'bytes=900-'});
  assert.equal(tail.headers.get('Content-Range'), 'bytes 900-999/1000');
  assert.equal((await get(e, q, {Range: 'bytes=5000-'})).status, 416);
  assert.equal((await get(e, '?name=nope')).status, 404);
});
