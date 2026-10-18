// Fill now's popup (owner, 19 Oct 2026): chips 1 / 3 / 5 / 10 (default 3) over the top jobs, the cost line before any AI is spent, Cancel sends nothing, the yes sends the codes.
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
const picked = ['a', 'b', 'c', 'd', 'e'].map((code, i) => ({code, name: `Job ${code} · Acme`, fit: 90 - i, needsKit: i > 0, needsCv: i > 1}));
const lines = {1: '1 job ready: nothing to prepare, no AI cost.', 3: '3 jobs: prepare 2 kits + 2 CVs with letters, about $0.20 of AI.', 5: '5 jobs: prepare 4 kits + 3 CVs, about $0.34 of AI.', 10: '5 jobs: prepare 4 kits + 3 CVs, about $0.34 of AI.'};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const state = () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {}, site: {batch: null, jobs: []}});

test('Fill now asks how many: 3 by default, the chips change the list and the cost, Cancel sends nothing, the yes sends the codes and shows Preparing', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const body = page(), ran = [];
  globalThis.window.pilot = {readyState: async () => state(), readyTonight: async () => ({ok: false}), readyTop: async () => ({ok: true, picked, chips: [1, 3, 5, 10], lines}),
    readyRun: options => { ran.push(options); return new Promise(() => {}); }};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  card.querySelector('#ready-run').click(); await tick();
  const dialog = globalThis.document.getElementById('ready-pick');
  assert.ok(dialog, 'the popup opens');
  const text = () => dialog.textContent;
  assert.equal([...dialog.querySelectorAll('.segmented button')].map(button => button.textContent).join(' '), '1 3 5 10');
  assert.equal(dialog.querySelector('.segmented .is-active').textContent, '3', 'default 3');
  assert.match(text(), /Job c · Acme/); assert.doesNotMatch(text(), /Job d/);
  assert.match(text(), /3 jobs: prepare 2 kits \+ 2 CVs with letters, about \$0\.20/);
  assert.equal(dialog.querySelector('#ready-pick-yes').textContent, 'Prepare and fill');
  [...dialog.querySelectorAll('.segmented button')].find(button => button.textContent === '1').click();
  assert.match(text(), /1 job ready: nothing to prepare/); assert.doesNotMatch(text(), /Job b/);
  assert.equal(dialog.querySelector('#ready-pick-yes').textContent, 'Fill now', 'nothing to prepare: no "Prepare"');
  assert.doesNotMatch(text(), /undefined|NaN/);
  dialog.querySelector('#ready-pick-no').click(); await tick();
  assert.deepEqual(ran, [], 'Cancel sends nothing');
  assert.equal(globalThis.document.getElementById('ready-pick'), null);

  card.querySelector('#ready-run').click(); await tick();
  globalThis.document.getElementById('ready-pick').querySelector('#ready-pick-yes').click(); await tick();
  assert.deepEqual(ran, [{top: ['a', 'b', 'c']}]);
  assert.match(card.textContent, /Preparing kits, CVs and letters/, 'the bar says what is happening while the jobs are made');
  assert.equal(card.querySelector('#ready-run').textContent, 'Filling…');
});
