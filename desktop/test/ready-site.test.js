// Ready to send, the app's calls to the site (lib/ready-site.js) and the window's handlers (lib/ready-handlers.js): the card shows only for the owner, a send reaches /api/ready/batch with the install key, and nothing else is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {done, owner, runNow, send} from '../lib/ready-site.js';
import {registerReadyHandlers} from '../lib/ready-handlers.js';
import {rowOf} from '../renderer/pages/ready-rows.js';

const storage = (extra = {}) => ({secret: name => (name === 'JOB_PILOTTO_TRIAL_KEY' || /TRIAL/.test(name) ? 'JPF1.install.token' : ''), settings: () => extra, saveSettings: patch => Object.assign(extra, patch), path: name => `/nowhere/${name}`});
const site = (status = 200, body = {ok: true}) => { const seen = []; return {seen, fetcher: async (url, init) => { seen.push({url, init}); return new Response(JSON.stringify(body), {status}); }}; };

test('the owner is whoever the site says yes to; 401 and 404 are no', async () => {
  assert.equal(await owner(storage(), {fetcher: site().fetcher}), true);
  assert.equal(await owner(storage(), {fetcher: site(401, {ok: false}).fetcher}), false);
  assert.equal(await owner(storage(), {fetcher: site(404, {}).fetcher}), false);
});

test('send, run and done reach their routes with the install key, and a refusal reads plainly', async () => {
  const fake = site(200, {ok: true, queued: 2});
  assert.equal((await send(storage(), {night: '2026-10-18', jobs: []}, {fetcher: fake.fetcher})).queued, 2);
  await runNow(storage(), {fetcher: fake.fetcher}); await done(storage(), 'j1', {fetcher: fake.fetcher});
  assert.deepEqual(fake.seen.map(s => new URL(s.url).pathname), ['/api/ready/batch', '/api/ready/run', '/api/ready/done']);
  assert.ok(fake.seen.every(s => s.init.headers['x-api-key'] === 'JPF1.install.token'));
  assert.equal(JSON.parse(fake.seen[2].init.body).job, 'j1');
  assert.match((await runNow(storage(), {fetcher: site(401, {ok: false}).fetcher})).error, /not on for this install/);
});

test('the window\'s handlers: not the owner = a closed card; the two numbers are kept in range', async () => {
  const handlers = {}, ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const kept = {};
  const realFetch = globalThis.fetch; globalThis.fetch = async () => new Response('{}', {status: 401});
  try {
    registerReadyHandlers({ipcMain, storage: storage(kept)});
    assert.deepEqual(await handlers.readyState(), {owner: false});
    assert.deepEqual((await handlers.readySettings({}, {minFit: 500, perNight: 99})).settings, {on: false, minFit: 100, perNight: 15});
  } finally { globalThis.fetch = realFetch; }
  for (const name of ['readyState', 'readySend', 'readyRun', 'readyDone', 'readyDeleteAll', 'readySettings']) assert.ok(handlers[name], name);
});

test('a row says what the site counted: complete, what is left, a wall', () => {
  assert.deepEqual(rowOf({state: 'prepared'}), {text: 'complete', tone: 'good', done: false, submitted: false});
  assert.equal(rowOf({state: 'partial', left_empty: 2}).text, 'needs you · 2 left');
  assert.equal(rowOf({state: 'wall', wall: 'account'}).text, 'a wall · account');
  assert.equal(rowOf({state: 'something-new'}).tone, 'info');
});
