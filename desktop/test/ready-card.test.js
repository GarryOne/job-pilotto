// The Ready to send card on Actions (renderer/pages/ready-card.js) is always shown: before the server answers, and whenever it cannot work it says why
// with its two buttons off (owner, 18 Oct 2026: "show the card always, no matter what... an error message/status and disabled buttons").
import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from './tiny-dom.js';

install();   // components.js builds elements as it loads; shared.js reads the app state once
globalThis.window.pilot = {state: async () => ({})};
const {initReadyCard} = await import('../renderer/pages/ready-card.js');

const page = () => {
  const body = install(), pair = globalThis.document.createElement('div'), tailor = globalThis.document.createElement('button');
  pair.className = 'task-pair'; tailor.id = 'tailor-top'; pair.append(tailor); body.append(pair);
  return body;
};
const buttons = card => card.querySelectorAll('.task-body button');
const textOf = node => node.textContent;

test('every way the card cannot work: it is shown, says why, and its buttons are off', async () => {
  const cases = [
    ['not the owner, with a reason', async () => ({owner: false, why: 'Our site gave this install no token today (its daily limit); asked again at 02:00.'}), /no token today/],
    ['not the owner, no reason', async () => ({owner: false}), /did not answer/],
    ['no answer at all', async () => null, /did not answer/],
    ['the call threw', async () => { throw new Error('the app is restarting'); }, /restarting/],
  ];
  for (const [name, readyState, says] of cases) {
    const body = page();
    globalThis.window.pilot = {readyState, readyTonight: async () => ({ok: false})};
    await initReadyCard();
    const card = body.querySelector('.ready-card');
    assert.ok(card, `${name}: the card is shown`);
    assert.match(textOf(card), says, name);
    assert.ok(textOf(card).includes('Not available'), name);
    assert.ok(buttons(card).length >= 2 && buttons(card).every(button => button.disabled), `${name}: Fill tonight and Fill now are off`);
    assert.ok(card.querySelector('.ready-status button'), `${name}: Try again`);
  }
});

test('the card shows at once, before the server answers, with its buttons off', async () => {
  const body = page();
  let answer;
  globalThis.window.pilot = {readyState: () => new Promise(resolve => { answer = resolve; }), readyTonight: async () => ({ok: false})};
  const done = initReadyCard();
  const card = body.querySelector('.ready-card');
  assert.ok(card && /Checking our server/.test(textOf(card)));
  assert.ok(buttons(card).every(button => button.disabled));
  answer({owner: false, why: 'x'}); await done;
});

test('on the owner\'s install the buttons work, and tonight\'s count comes from a fresh job read', async () => {
  const body = page();
  globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {}, site: {batch: null, jobs: []}}),
    readyTonight: async () => ({ok: true, tonight: [{code: 'a'}, {code: 'b'}], names: {}})};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  assert.ok(buttons(card).every(button => !button.disabled));
  assert.match(textOf(card), /Tonight: 2 of your finished jobs/);
  assert.ok(!textOf(card).includes('Not available'));
});

test('Try again answers visibly: Checking… while it asks, then the reason with the time it was checked (owner, 18 Oct 2026)', async () => {
  const body = page();
  let asked = 0, answer;
  globalThis.window.pilot = {readyState: () => { asked++; return asked === 1 ? Promise.resolve({owner: false, why: 'Not yet.'}) : new Promise(resolve => { answer = resolve; }); }, readyTonight: async () => ({ok: false})};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  assert.match(textOf(card), /Not yet\. · checked \d\d:\d\d:\d\d/);
  const again = card.querySelector('.ready-status button');
  again.click();
  assert.equal(asked, 2, 'asked the server again');
  assert.equal(again.textContent, 'Checking…'); assert.equal(again.disabled, true);
  answer({owner: false, why: 'Still not.'}); await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(textOf(body.querySelector('.ready-card')), /Still not\. · checked/);
});

test('what went to the server for tonight (by hand or by itself) is said on the card; nothing sent, no line', async () => {
  for (const [sent, says] of [[{count: 3, at: new Date(2026, 9, 18, 18, 40).toISOString()}, /Sent for tonight: 3 jobs · 18:40/], [null, null]]) {
    const body = page();
    globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {}, site: {batch: null, jobs: []}, sent}),
      readyTonight: async () => ({ok: false})};
    await initReadyCard();
    const text = textOf(body.querySelector('.ready-card'));
    if (says) assert.match(text, says); else assert.ok(!text.includes('Sent for tonight'));
  }
});

// The card follows a running night (live demo, 18 Oct 2026: after Fill now it re-read once at 30 s and the rows stayed "waiting" while the server had filled both forms;
// switching pages did not help). Each state a night can be in: re-read while it runs (or right after Fill now), stop when it ends, never re-read tonight's job list.
test('the card re-reads the night while the server fills it, and stops when it ends', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const {FOLLOW_MS} = await import('../renderer/pages/ready-card.js');
  const cases = [
    ['running at open', ['running', 'running', 'finished'], false, 2],
    ['queued, then Fill now', ['queued', 'queued', 'running', 'finished'], true, 2],
    ['queued for tonight, no Fill now: no re-read', ['queued'], false, 0],
    ['finished at open: no re-read', ['finished'], false, 0],
    ['failed while running', ['running', 'failed'], false, 1],
  ];
  for (const [name, states, pressRun, rereads] of cases) {
    const body = page();
    let read = 0, tonight = 0;
    const night = () => states[Math.min(read, states.length - 1)];
    globalThis.window.pilot = {
      readyState: async () => { const state = night(); read++; return {owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {j: 'Job · Co'},
        site: {batch: {night: '2026-10-19', state}, jobs: [{job: 'j', state: state === 'finished' ? 'prepared' : 'queued'}]}}; },
      readyTonight: async () => { tonight++; return {ok: false}; }, readyRun: async () => ({ok: true})};
    await initReadyCard();
    const card = body.querySelector('.ready-card');
    if (pressRun) { card.querySelector('#ready-run').click(); await new Promise(resolve => setImmediate(resolve)); }
    const before = read, tonightBefore = tonight;
    for (let i = 0; i < 6; i++) { t.mock.timers.tick(FOLLOW_MS); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(read - before, rereads, `${name}: re-reads`);
    assert.equal(tonight, tonightBefore, `${name}: tonight's job list is not re-read while following`);
    if (states.at(-1) === 'finished' && rereads) assert.match(textOf(card), /complete/, `${name}: the row turns complete`);
  }
});

test('the card stops following once it is no longer on the page', async t => {
  t.mock.timers.enable({apis: ['setInterval']});
  const {FOLLOW_MS} = await import('../renderer/pages/ready-card.js');
  const body = page();
  let read = 0;
  globalThis.window.pilot = {readyState: async () => { read++; return {owner: true, settings: {}, tonight: [], names: {}, site: {batch: {state: 'running'}, jobs: []}}; }, readyTonight: async () => ({ok: false})};
  await initReadyCard();
  body.querySelector('.ready-card').remove();
  const before = read;
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(FOLLOW_MS); await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(read - before <= 1, 'at most the one read that finds it gone');
});

// The twin's driver refuses to press anything that reads like a Submit (e2e/lib/twin-guards.mjs), so no control on the card may read like one, or a live demo cannot
// press it (18 Oct 2026: "Open live" was refused for its tooltip "…press Submit yourself"). Every button of a card with each kind of row, text and tooltip.
test('no control on the card reads like a Submit to the twin\'s guard', async () => {
  const {looksLikeSubmit} = await import('../e2e/lib/twin-guards.mjs');
  const body = page();
  globalThis.window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {},
    site: {batch: {night: '2026-10-19', state: 'finished'}, jobs: ['prepared', 'partial', 'wall', 'no-form', 'failed', 'queued'].map((state, i) => ({job: `j${i}`, state}))}}),
    readyTonight: async () => ({ok: false})};
  await initReadyCard();
  const all = body.querySelector('.ready-card').querySelectorAll('button');
  assert.ok(all.length >= 9, 'Fill tonight, Fill now, Open live ×3, Done ×6');
  for (const button of all) assert.ok(!looksLikeSubmit(`${textOf(button)} ${button.title || ''} ${button.getAttribute('aria-label') || ''}`), `${textOf(button)} / ${button.title}`);
});
