// The Ready to send card on Actions (renderer/pages/ready-card.js) is always shown: before the server answers, and whenever it cannot work it says why
// with its two buttons off (owner, 18 Oct 2026: "show the card always, no matter what... an error message/status and disabled buttons").
import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from './tiny-dom.js';

install();   // components.js builds elements as it loads; shared.js reads the app state once
window.pilot = {state: async () => ({})};
const {initReadyCard} = await import('../renderer/pages/ready-card.js');

const page = () => {
  const body = install(), pair = document.createElement('div'), tailor = document.createElement('button');
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
    window.pilot = {readyState, readyTonight: async () => ({ok: false})};
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
  window.pilot = {readyState: () => new Promise(resolve => { answer = resolve; }), readyTonight: async () => ({ok: false})};
  const done = initReadyCard();
  const card = body.querySelector('.ready-card');
  assert.ok(card && /Checking our server/.test(textOf(card)));
  assert.ok(buttons(card).every(button => button.disabled));
  answer({owner: false, why: 'x'}); await done;
});

test('on the owner\'s install the buttons work, and tonight\'s count comes from a fresh job read', async () => {
  const body = page();
  window.pilot = {readyState: async () => ({owner: true, settings: {minFit: 60, perNight: 10}, tonight: [], names: {}, site: {batch: null, jobs: []}}),
    readyTonight: async () => ({ok: true, tonight: [{code: 'a'}, {code: 'b'}], names: {}})};
  await initReadyCard();
  const card = body.querySelector('.ready-card');
  assert.ok(buttons(card).every(button => !button.disabled));
  assert.match(textOf(card), /Tonight: 2 of your finished jobs/);
  assert.ok(!textOf(card).includes('Not available'));
});
