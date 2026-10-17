// The app's periodic or repeated reads of the engine (job list, calendar) never pile up (17 Oct 2026: a card asked for the job list on every activity event, each read took ~60 s on a slow Notion day, 187 Python runs at once):
// a second ask while one runs joins it. Loops over every shared engine read, so a new one added without the guard is one line here.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';
import {registerReadyHandlers} from '../lib/ready-handlers.js';

const READS = {jobs: (storage, run) => pipeline.jobs(storage, 200, run), 'jobs (another limit)': (storage, run) => pipeline.jobs(storage, 400, run), calendarJobs: (storage, run) => pipeline.calendarJobs(storage, run)};

test('every shared engine read: a slow read (never answered) is started once however often it is asked', async () => {
  for (const [name, ask] of Object.entries(READS)) {
    let started = 0, release;
    const slow = new Promise(resolve => { release = resolve; });
    const run = async () => { started += 1; await slow; return {code: 0, stdout: '{"jobs":[],"ok":true}\n'}; };
    const storage = {settings: () => ({lastSearchAt: 'x'})};
    const asks = Array.from({length: 30}, () => ask(storage, run));   // 30 asks at once (the 2-second beat of a card, for a minute)
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(started, 1, name);
    release();
    await Promise.all(asks);
  }
});

test('the Ready to send card says owner and shows the night\'s rows without waiting for the job list', async () => {
  const handlers = {}, ipcMain = {handle: (name, fn) => { handlers[name] = fn; }};
  const seen = [], store = {telemetryId: 'install-1'};
  const storage = {secret: name => (name === 'READY_OWNER_SECRET' ? 's' : 'JPF1.install.token'), settings: () => store, saveSettings: patch => Object.assign(store, patch), path: name => `/nowhere/${name}`, readText: () => ''};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { seen.push(new URL(url).pathname); return new Response(JSON.stringify({ok: true, batch: {night: '2026-10-18', state: 'finished', costUsd: 0}, jobs: [{job: 'j1', state: 'prepared'}]}), {status: 200}); };
  try {
    registerReadyHandlers({ipcMain, storage});
    const state = await Promise.race([handlers.readyState(), new Promise(resolve => setTimeout(() => resolve('waited'), 3000))]);
    assert.equal(state.owner, true);
    assert.equal(state.site.jobs.length, 1);
    assert.deepEqual(state.tonight, []);   // no cached list yet: the card asks readyTonight afterwards
    assert.ok(handlers.readyTonight);
  } finally { globalThis.fetch = realFetch; }
});
