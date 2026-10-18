// The Ready to send card never prints "undefined", "NaN" or "null" in any state a night can be in (owner, 19 Oct 2026: a lone "undefinedNaNs" line under the summary).
import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from './tiny-dom.js';

install();
globalThis.window.pilot = {state: async () => ({})};
const {initReadyCard} = await import('../renderer/pages/ready-card.js');

const page = () => {
  const body = install(), pair = globalThis.document.createElement('div'), tailor = globalThis.document.createElement('button');
  pair.className = 'task-pair'; tailor.id = 'tailor-top'; pair.append(tailor); body.append(pair);
  return body;
};
const done = {job: 'a', host: 'x.com', state: 'prepared'}, filling = {job: 'b', host: 'y.com', state: 'filling', step: 'filling'}, waiting = {job: 'c', host: 'z.com', state: 'queued'};
const withBatch = (state, jobs, extra = {}) => ({state, night: '2026-10-18', costUsd: 0.01, ...extra, jobs});
const NIGHTS = {
  'no night': null,
  'queued': withBatch('queued', [waiting]),
  'running, one filling, one waiting': withBatch('running', [filling, waiting]),
  'running, every form complete (stale)': withBatch('running', [done, {...done, job: 'd'}]),
  'running, no jobs': withBatch('running', []),
  'finished': withBatch('finished', [done, {...done, job: 'd'}]),
  'capped': withBatch('capped', [done]),
  'failed rows': withBatch('finished', [{job: 'e', host: 'q.com', state: 'failed'}, {job: 'f', host: 'r.com', state: 'wall'}]),
  'rows with no fields': withBatch('running', [{job: 'g'}]),
  'batch with no fields': {jobs: [{job: 'h', state: 'filling', started_at: 'garbage'}]},
};

test('no state of the Ready to send card prints undefined, NaN or null', async t => {
  t.mock.timers.enable({apis: ['setInterval']});   // a running night makes the card follow it every few seconds
  for (const [name, batch] of Object.entries(NIGHTS)) {
    const body = page();
    globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {}, site: {batch: batch && {...batch, jobs: undefined}, jobs: batch?.jobs || []}}),
      readyTonight: async () => ({ok: false}), readySend: async () => ({ok: true, queued: 1, night: '2026-10-18'})};
    await initReadyCard();
    const card = body.querySelector('.ready-card');
    assert.doesNotMatch(card.textContent, /undefined|NaN|null/, name);
    const busy = batch?.state === 'running' && (!batch.jobs.length || batch.jobs.some(job => ['queued', 'filling'].includes(job.state)));
    const run = card.querySelector('#ready-run');
    assert.equal(run.textContent === 'Filling…', busy, `${name}: "Filling…" only while a form is still being filled`);
  }
});

// The cause (owner, 19 Oct 2026): the Sessions page's clock rewrote every [data-since] node in the window, the card's bars included, as `undefined` + `NaN` + "s".
test('the Sessions clock leaves the card\'s bar and live rows alone (Sending, and a form filling)', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const {tickSessionClocks} = await import('../renderer/session-state.js');
  const body = page();
  const batch = {state: 'running', night: '2026-10-18', costUsd: 0}, jobs = [{job: 'b', host: 'y.com', state: 'filling', step: 'filling', started_at: new Date().toISOString()}];
  globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {}, site: {batch, jobs}}),
    readyTonight: async () => ({ok: false}), readyRun: () => new Promise(() => {})};   // a press that has not answered yet: "Sending"
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  card.querySelector('#ready-run').click();
  const before = card.textContent;
  assert.match(before, /Sending/);
  assert.match(before, /Filling the form/);
  tickSessionClocks(globalThis.document);
  assert.equal(card.textContent.replace(/\d+:\d\d/g, ''), before.replace(/\d+:\d\d/g, ''), 'the sessions clock changed the card');
  assert.doesNotMatch(card.textContent, /undefined|NaN/);
});
