// lib/report-upload.js (spec 2026-10-15-report-this-form.md §4): the approved record is encrypted on this Mac for the owner's key only, sent with the install's own 'report' token, refused when
// this is not a real install or the bundle is over the cap, and the ids it sent can be deleted. The test makes its own key pair: the real private key never leaves the owner's Keychain.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {test} from 'node:test';
import {bundleOf, createUploader, encryptBundle} from '../lib/report-upload.js';
import {setSiteOff} from '../lib/recipes.js';

const {publicKey, privateKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048, publicKeyEncoding: {type: 'spki', format: 'pem'}, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}});
const record = () => ({entries: [{method: 'GET', url: 'https://jobs.example.test/apply', type: 'document', hash: 'h1', size: 5, headers: {'content-type': 'text/html'}, status: 200, startMs: 0, waitMs: 1, bodyKey: '', failed: false, hadCookie: false, mode: ''}],
  bodies: new Map([['h1', Buffer.from('<p>x</p>')]]), stats: {requests: 1}});
const storage = () => { const kept = {}; return {settings: () => kept, saveSettings: patch => Object.assign(kept, patch)}; };
const decrypt = (body, wrapped) => {
  const key = crypto.privateDecrypt({key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256'}, Buffer.from(wrapped, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, body.subarray(0, 12)); decipher.setAuthTag(body.subarray(12, 28));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([decipher.update(body.subarray(28)), decipher.final()])));
};

test('the product\'s public key is the harness\'s: one key, so the owner\'s Keychain key opens both', () => {
  assert.equal(fs.readFileSync(new URL('../lib/report-key.pem', import.meta.url), 'utf8'), fs.readFileSync(new URL('../e2e/net-record.pub.pem', import.meta.url), 'utf8'));
});

test('encrypted for the owner\'s key only: it opens with the private key to the record and its bodies, and nothing readable is in what is sent', () => {
  const bundle = bundleOf(record(), 1000), {body, wrapped} = encryptBundle(bundle, publicKey);
  assert.ok(!body.includes('jobs.example.test') && !body.includes('<p>x</p>'), 'the sent bytes hold no address or page');
  const opened = decrypt(body, wrapped);
  assert.equal(opened.record.source, 'person'); assert.match(opened.record.name, /^reported-[0-9a-f]{6}-example\.test$/);
  assert.equal(Buffer.from(opened.bodies.h1, 'base64').toString(), '<p>x</p>');
  assert.throws(() => decrypt(Buffer.concat([body.subarray(0, 40), Buffer.from('x'), body.subarray(41)]), wrapped), 'a changed byte is refused');
});

test('send: mints a report token once, posts the bundle with the install\'s headers, keeps the id; delete removes what was sent', async () => {
  setSiteOff('');
  const calls = [], answers = [{token: 'T1'}, {ok: true, id: 'r-1'}, {ok: true}], store = storage();
  const fetcher = async (url, init) => { calls.push({url, init}); return Response.json(answers.shift() ?? {ok: true}); };
  const up = createUploader({storage: store, fetcher, base: 'https://site.test', pem: publicKey, now: () => 5});
  assert.deepEqual(await up.send(record()), {ok: true, id: 'r-1'});
  assert.equal(calls[0].url, 'https://site.test/api/install-token'); assert.equal(JSON.parse(calls[0].init.body).purpose, 'report');
  assert.equal(calls[1].url, 'https://site.test/api/report-form'); assert.equal(calls[1].init.headers.Authorization, 'Bearer T1');
  assert.match(calls[1].init.headers['X-Install'], /^[\w-]{8,64}$/);
  assert.equal(decrypt(calls[1].init.body, calls[1].init.headers['X-Report-Key']).record.url, 'https://jobs.example.test/apply');
  assert.equal(up.count(), 1);
  assert.deepEqual(await up.deleteAll(), {ok: true, deleted: 1});
  assert.equal(calls[2].init.method, 'DELETE'); assert.equal(calls[2].url, 'https://site.test/api/report-form/r-1'); assert.equal(up.count(), 0);
});

test('nothing is sent when this is not a real install, when the bundle is over the cap, or when the site says no', async () => {
  const never = async () => { throw new Error('the network was touched'); };
  setSiteOff('a test run');
  assert.equal((await createUploader({storage: storage(), fetcher: never, pem: publicKey}).send(record())).ok, false);
  assert.deepEqual(await createUploader({storage: storage(), fetcher: never, pem: publicKey}).deleteAll(), {ok: false, deleted: 0});
  setSiteOff('');
  const big = record(); big.bodies = new Map([['h1', crypto.randomBytes(9 * 1024 * 1024)]]);
  assert.match((await createUploader({storage: storage(), fetcher: never, pem: publicKey}).send(big)).error, /too large/);
  const limited = createUploader({storage: storage(), pem: publicKey, fetcher: async url => (url.endsWith('install-token') ? Response.json({token: 'T'}) : Response.json({ok: false}, {status: 429}))});
  assert.match((await limited.send(record())).error, /most reports for today/);
});
