// The extension package served by the website: published by the private repo's CI, given to a license or a running trial.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {newer, pack, publish} from '../src/extension-pack.js';
import {tokenFor} from '../src/recipes.js';

const kvStore = () => { const map = new Map(); return {map, get: async (key, type) => { const v = map.get(key); return v === undefined ? null : type === 'arrayBuffer' && typeof v === 'string' ? new TextEncoder().encode(v).buffer : v; }, put: async (key, value) => { map.set(key, value); }}; };
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const env = () => ({WAITLIST: kvStore(), STATS_KEY: 'secret', EXTENSION_PUBLISH_TOKEN: 'publish-secret', EXTENSION_TRIAL_DAYS: '60'});
const body = Buffer.from('package-bytes');
const send = (e, version = '0.8.60', {token = 'publish-secret', bytes = body, hash = sha(bytes)} = {}) => publish(new Request('https://x/api/extension/publish', {method: 'POST',
  headers: {Authorization: `Bearer ${token}`, 'X-Version': version, 'X-Hash': hash}, body: bytes}), e);
const ask = async (e, path, {install = 'install-abc123', license = '', now = new Date('2026-10-02T12:00:00Z'), token} = {}) => pack(new Request(`https://x/api/extension/${path}`, {
  headers: {Authorization: `Bearer ${token ?? await tokenFor(install, e)}`, 'X-Install': install, ...(license ? {'X-License': license} : {})}}), e, now);

test('only the extension repo\'s CI can publish, a version only goes up, and the hash must match', async () => {
  const e = env();
  assert.equal((await send(e, '0.8.60', {token: 'nope'})).status, 401);
  assert.equal((await send(e, 'v1')).status, 400);
  assert.equal((await send(e, '0.8.60', {hash: 'f'.repeat(64)})).status, 400);
  assert.equal((await send(e, '0.8.60')).status, 200);
  assert.equal((await send(e, '0.8.61')).status, 200);
  assert.equal((await send(e, '0.8.9')).status, 409);          // 0.8.9 is older than 0.8.61 (numbers, not text)
  assert.equal((await send(e, '0.8.61')).status, 200);         // the same version again: a re-run of CI
});

test('an install inside its trial gets the version and the package; an unknown token gets nothing', async () => {
  const e = env();
  await send(e, '0.8.60');
  const latest = await (await ask(e, 'latest')).json();
  assert.deepEqual([latest.ok, latest.version, latest.hash, latest.via, latest.daysLeft], [true, '0.8.60', sha(body), 'trial', 60]);
  const download = await ask(e, 'download');
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('X-Hash'), sha(body));
  assert.equal((await ask(e, 'latest', {token: 'wrong'})).status, 401);
});

test('after the trial the extension needs a license key; a bad key does not count', async () => {
  const e = env();
  await send(e, '0.8.60');
  await ask(e, 'latest', {now: new Date('2026-10-02T12:00:00Z')});                       // first ask: the trial starts
  const late = await ask(e, 'latest', {now: new Date('2026-12-15T12:00:00Z')});         // 74 days later
  assert.equal(late.status, 402);
  assert.equal((await late.json()).gate, 'license');
  assert.equal((await ask(e, 'latest', {license: 'JP1.bad.key', now: new Date('2026-12-15T12:00:00Z')})).status, 402);
});

test('nothing published yet is a clear answer, and versions compare as numbers', async () => {
  assert.equal((await ask(env(), 'latest')).status, 404);
  assert.equal(newer('0.8.10', '0.8.9'), true);
  assert.equal(newer('0.8.9', '0.8.10'), false);
  assert.equal(newer('1.0.0', '1.0.0'), false);
});
