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

test('each filled form counts for its board and goes in the same batch; nothing when reports are off', async () => {
  const storage = tempStorage();
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({})});
  reporter.fill('ashby'); reporter.fill('ashby'); reporter.fill('h:0123456789'); reporter.fill('bad board!'); reporter.fill('');
  assert.deepEqual(await reporter.flush(), {sent: 2});
  assert.deepEqual(sent[0].exposure, [{board: 'ashby', n: 2}, {board: 'h:0123456789', n: 1}]);
  storage.saveSettings({telemetry: false});
  reporter.fill('ashby');
  assert.deepEqual(await reporter.flush(), {sent: 0});
});

test('question wording and where an application got to are batched per board, cleaned, and follow the privacy switch', async () => {
  const storage = tempStorage(), net = site();
  const reporter = createReporter(storage, {fetcher: net.fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.question([{label: 'Heimatort *', kind: 'text'}, {label: 'Mail me at jane@example.com', kind: 'text'}, {label: 'Heimatort', kind: 'text'}], 'greenhouse');
  reporter.question([{label: 'Notice period', kind: 'select'}], 'bad board!');   // not a board name: ignored
  reporter.flow('ashby', 'no-form'); reporter.flow('ashby', 'no-form'); reporter.flow('ashby', 'filled'); reporter.flow('ashby', 'made-up');
  await reporter.flush();
  const body = net.calls.find(call => call[0] === '/api/controls')[1];
  assert.deepEqual(body.questions, [{label: 'heimatort', kind: 'text', board: 'greenhouse'}]);   // cleaned, deduplicated, the address dropped
  assert.deepEqual(body.flows, [{board: 'ashby', state: 'no-form', n: 2}, {board: 'ashby', state: 'filled', n: 1}]);
  storage.saveSettings({telemetry: false});
  const quiet = site();
  const off = createReporter(storage, {fetcher: quiet.fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  off.question([{label: 'Heimatort', kind: 'text'}], 'greenhouse'); off.flow('ashby', 'filled');
  await off.flush();
  assert.equal(quiet.calls.length, 0);   // reports off: nothing leaves this Mac
});

test('a failed send keeps the questions and flow counts for the next try', async () => {
  const storage = tempStorage();
  let status = 500;
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
    calls.push(JSON.parse(init.body));
    return {ok: status < 400, status, json: async () => ({ok: true})};
  };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.question([{label: 'Heimatort', kind: 'text'}], 'lever'); reporter.flow('lever', 'account');
  assert.equal((await reporter.flush()).sent, 0);
  status = 200;
  assert.equal((await reporter.flush()).sent, 2);
  assert.deepEqual([calls[1].questions.length, calls[1].flows], [1, [{board: 'lever', state: 'account', n: 1}]]);
});

test('how an application went is batched by board, outcome and days; anything else is refused; off with the privacy switch', async () => {
  const storage = tempStorage(), calls = [];
  const fetcher = async (url, init = {}) => {
    if (new URL(url).pathname === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
    calls.push(JSON.parse(init.body));
    return {ok: true, status: 200, json: async () => ({ok: true})};
  };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.application({board: 'greenhouse', outcome: 'reply', days: '8-14'});
  reporter.application({board: 'greenhouse', outcome: 'reply', days: '8-14', company: 'Grafana', url: 'https://x.test'});
  reporter.application({board: 'h:0123456789', outcome: 'rejected', days: ''});
  reporter.application({board: 'greenhouse', outcome: 'hired', days: '8-14'});     // not an outcome
  reporter.application({board: 'greenhouse', outcome: 'reply', days: 'a week'});   // not a bucket
  reporter.application({board: 'bad board!', outcome: 'reply', days: ''});
  reporter.application(null);
  await reporter.flush();
  assert.deepEqual(calls[0].applications, [{board: 'greenhouse', outcome: 'reply', days: '8-14', n: 2}, {board: 'h:0123456789', outcome: 'rejected', days: '', n: 1}]);
  assert.equal(JSON.stringify(calls[0]).includes('Grafana'), false);
  storage.saveSettings({telemetry: false});
  const off = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  off.application({board: 'greenhouse', outcome: 'reply', days: '8-14'});
  calls.length = 0;
  await off.flush();
  assert.equal(calls.length, 0);
});
