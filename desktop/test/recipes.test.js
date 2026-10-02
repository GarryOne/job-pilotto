// The app's side of the recipe library (lib/recipes.js): asks by fingerprint, remembers, validates, respects the privacy switch,
// and sends back counts in batches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {installId} from '../lib/app-feedback.js';
import {createReporter, lookup} from '../lib/recipes.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => v, decrypt: v => v};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-recipes-')), fakeCrypto);
const recipe = (extra = {}) => ({fingerprint: '1d2pcapx18', version: 2, operator: 'toggle', params: {onAttr: 'aria-pressed', onValue: 'true'}, rollout: 100, ...extra});
const site = (answers = {}) => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push([new URL(url).pathname, init.body ? JSON.parse(init.body) : null, init.headers?.Authorization || '']);
    const path = new URL(url).pathname;
    const reply = (status, body) => ({ok: status < 400, status, json: async () => body});
    if (path === '/api/install-token') return reply(200, {token: 'tok123'});
    if (path === '/api/recipes/lookup') return reply(200, {recipes: answers.recipes ?? [recipe()]});
    if (path === '/api/controls') return answers.controls ? reply(answers.controls, {}) : reply(200, {ok: true});
    return reply(404, {});
  };
  return {calls, fetcher};
};

test('recipes come back for the fingerprints asked, validated, with one token kept and answers remembered (also none)', async () => {
  const storage = tempStorage(), net = site({recipes: [recipe(), recipe({fingerprint: 'bad0001', operator: 'run-code'})]});
  const found = await lookup(storage, ['1d2pcapx18', 'bad0001', 'none0001', 'NOT VALID'], {fetcher: net.fetcher, base: 'https://site.test'});
  assert.deepEqual(Object.keys(found), ['1d2pcapx18']);   // an invalid recipe never reaches the extension
  assert.deepEqual(net.calls.map(c => c[0]), ['/api/install-token', '/api/recipes/lookup']);
  assert.deepEqual(net.calls[1][1].fingerprints, ['1d2pcapx18', 'bad0001', 'none0001']);
  assert.equal(net.calls[1][2], 'Bearer tok123');
  const again = await lookup(storage, ['1d2pcapx18', 'none0001'], {fetcher: net.fetcher, base: 'https://site.test'});
  assert.deepEqual(Object.keys(again), ['1d2pcapx18']);
  assert.equal(net.calls.length, 2);   // all remembered, nothing asked
  await lookup(storage, ['1d2pcapx18'], {fetcher: net.fetcher, base: 'https://site.test', now: Date.now() + 7 * 3600 * 1000});
  assert.equal(net.calls.length, 3);   // after six hours it asks again, with the kept token
  assert.equal(net.calls[2][0], '/api/recipes/lookup');
});

test('with Technical reports off, no fingerprint leaves the Mac; an offline site means no recipes, not an error', async () => {
  const storage = tempStorage(), net = site();
  storage.saveSettings({telemetry: false});
  assert.deepEqual(await lookup(storage, ['1d2pcapx18'], {fetcher: net.fetcher, base: 'https://site.test'}), {});
  assert.equal(net.calls.length, 0);
  const on = tempStorage();
  const down = async () => { throw new Error('offline'); };
  assert.deepEqual(await lookup(on, ['1d2pcapx18'], {fetcher: down, base: 'https://site.test'}), {});
});

test('a rejected token is replaced once', async () => {
  const storage = tempStorage();
  storage.saveSettings({recipesToken: {install: installId(storage), value: 'stale'}});
  let rejected = false;
  const fetcher = async (url, init = {}) => {
    const reply = (status, body) => ({ok: status < 400, status, json: async () => body});
    const path = new URL(url).pathname;
    if (path === '/api/install-token') return reply(200, {token: 'fresh'});
    if (init.headers.Authorization === 'Bearer stale') { rejected = true; return reply(401, {}); }
    return reply(200, {recipes: [recipe()]});
  };
  const found = await lookup(storage, ['1d2pcapx18'], {fetcher, base: 'https://site.test'});
  assert.deepEqual(Object.keys(found), ['1d2pcapx18']);
  assert.equal(rejected, true);
});

test('outcomes are counted per fingerprint and recipe and sent in one batch; a failed send keeps them for the next try', async () => {
  const storage = tempStorage();
  let status = 500;
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: status < 400, status, json: async () => ({})}; };
  const timers = [];
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: fn => { timers.push(fn); return {}; }});
  reporter.outcome([{fp: '1d2pcapx18', recipe: 0, ok: true}, {fp: '1d2pcapx18', recipe: 0, ok: false}, {fp: '1d2pcapx18', recipe: 2, ok: true}, {fp: 'NOT VALID', ok: true}]);
  reporter.sample([{fingerprint: 'abc123', kind: 'switch', skeleton: {t: 'div', a: {}, c: [], k: []}, question: 'Remote?'}]);
  assert.equal(timers.length, 1);   // one flush scheduled, not one per item
  assert.deepEqual(await reporter.flush(), {sent: 0});
  status = 200;
  assert.deepEqual(await reporter.flush(), {sent: 3});   // two outcome rows and one sample
  const body = sent.at(-1);
  assert.deepEqual(body.outcomes.map(o => [o.fp, o.recipe, o.ok, o.failed]).sort(), [['1d2pcapx18', 0, 1, 1], ['1d2pcapx18', 2, 1, 0]]);
  assert.equal(body.samples[0].fingerprint, 'abc123');
  assert.deepEqual(await reporter.flush(), {sent: 0});   // nothing left
  storage.saveSettings({telemetry: false});
  reporter.outcome([{fp: '1d2pcapx18', ok: true}]);
  assert.deepEqual(await reporter.flush(), {sent: 0});   // switched off: nothing is kept or sent
});
