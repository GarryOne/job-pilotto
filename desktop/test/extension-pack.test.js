// The app's side of the extension delivery: ask the site, verify, install in the data folder, keep the old one when anything fails.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pack from '../lib/extension-pack.js';
import {createStorage} from '../lib/storage.js';
import {tar} from '../lib/tar.js';

const fakeCrypto = {encrypt: v => v, decrypt: v => v};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-extpack-')), fakeCrypto);
// A real .tar.gz of a one-file "extension", as the private repo's CI builds it.
function tgz(version) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'extsrc-'));
  fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({name: 'Job Pilotto', version}));
  fs.writeFileSync(path.join(src, 'background.js'), `// ${version}\n`);
  const out = path.join(os.tmpdir(), `ext-${version}-${process.pid}-${Math.random().toString(16).slice(2)}.tgz`);
  execFileSync(tar(), ['-czf', out, '-C', src, '.']);
  return fs.readFileSync(out);
}
const site = ({version = '0.8.60', status = 200, bytes = tgz(version), hash} = {}) => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const route = new URL(url).pathname;
    calls.push([route, init.headers || {}]);
    const reply = (code, body) => ({ok: code < 400, status: code, json: async () => body});
    if (route === '/api/install-token') return reply(200, {token: 'tok'});
    if (route === '/api/extension/latest') return status === 200 ? reply(200, {ok: true, version, hash: hash || crypto.createHash('sha256').update(bytes).digest('hex'), via: 'trial'})
      : reply(status, {ok: false, error: 'The trial is over', gate: 'license'});
    if (route === '/api/extension/download') return {ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
    return reply(404, {});
  };
  return {fetcher, calls};
};

test('the first sync downloads the package, checks it and installs it in the data folder', async () => {
  const storage = tempStorage(), {fetcher, calls} = site({version: '0.8.60'});
  const result = await pack.sync(storage, {fetcher, base: 'https://x'});
  assert.deepEqual([result.ok, result.version, result.updated], [true, '0.8.60', true]);
  assert.equal(pack.installedVersion(pack.folder(storage)), '0.8.60');
  assert.ok(fs.existsSync(path.join(pack.folder(storage), 'background.js')));
  assert.equal(calls.find(([route]) => route === '/api/extension/latest')[1].Authorization, 'Bearer tok');
  assert.deepEqual(pack.status(storage), {present: true, version: '0.8.60', gate: ''});
});

test('the same or an older version downloads nothing; a newer one replaces the folder', async () => {
  const storage = tempStorage();
  await pack.sync(storage, {fetcher: site({version: '0.8.60'}).fetcher, base: 'https://x'});
  const same = site({version: '0.8.60'});
  assert.equal((await pack.sync(storage, {fetcher: same.fetcher, base: 'https://x'})).updated, false);
  assert.equal(same.calls.some(([route]) => route === '/api/extension/download'), false);
  assert.equal((await pack.sync(storage, {fetcher: site({version: '0.8.61'}).fetcher, base: 'https://x'})).updated, true);
  assert.equal(pack.installedVersion(pack.folder(storage)), '0.8.61');
  assert.equal(fs.existsSync(`${pack.folder(storage)}.previous`), false);
});

test('a package that does not match its hash, or holds another version, is refused and the installed one stays', async () => {
  const storage = tempStorage();
  await pack.sync(storage, {fetcher: site({version: '0.8.60'}).fetcher, base: 'https://x'});
  const tampered = await pack.sync(storage, {fetcher: site({version: '0.8.61', hash: '0'.repeat(64)}).fetcher, base: 'https://x'});
  assert.equal(tampered.ok, false);
  assert.match(tampered.error, /hash/);
  const wrong = await pack.sync(storage, {fetcher: site({version: '0.8.62', bytes: tgz('0.8.61')}).fetcher, base: 'https://x'});
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /holds 0.8.61/);
  assert.equal(pack.installedVersion(pack.folder(storage)), '0.8.60');
});

test('a closed trial is reported as the license gate, and nothing is installed', async () => {
  const storage = tempStorage();
  const result = await pack.sync(storage, {fetcher: site({status: 402}).fetcher, base: 'https://x'});
  assert.deepEqual([result.ok, result.gate], [false, 'license']);
  assert.deepEqual(pack.status(storage), {present: false, version: '', gate: 'license'});
});

test('the license key goes with the request, and an offline site changes nothing', async () => {
  const storage = tempStorage();
  storage.saveSettings({license: {key: 'JP1.a.b'}});
  const {fetcher, calls} = site();
  await pack.sync(storage, {fetcher, base: 'https://x'});
  assert.equal(calls.find(([route]) => route === '/api/extension/latest')[1]['X-License'], 'JP1.a.b');
  const offline = await pack.sync(storage, {fetcher: async () => { throw new Error('offline'); }, base: 'https://x'});
  assert.equal(offline.ok, false);
  assert.equal(pack.installedVersion(pack.folder(storage)), '0.8.60');
});
