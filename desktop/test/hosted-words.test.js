// Always on "on our servers": the card's states and words (renderer/hosted-words.js), one name everywhere, ON by default until Skip (owner, 17 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {NAME, model, when} from '../renderer/hosted-words.js';

const now = new Date(2026, 9, 17, 9, 0);   // local time
const tomorrow7 = new Date(2026, 9, 18, 7, 0).toISOString();

test('a trial install that did not press Skip shows ON; without an e-mail it asks for it first', () => {
  const fresh = model({}, null, now);
  assert.deepEqual([fresh.state, fresh.pill, fresh.asksEmail, fresh.button], ['needs-email', ['On', 'good'], true, 'save']);
  assert.match(fresh.line, /Add your email to get the matches/);
  assert.equal(fresh.off, false);
});

test('on with an e-mail: the badge, the address, the next run time and Turn off', () => {
  const on = model({on: true, email: 'a@example.com'}, {state: 'on', next_run_at: tomorrow7, email_channel: 1}, now);
  assert.deepEqual([on.state, on.pill, on.asksEmail, on.button, on.off, on.download], ['on', ['On', 'good'], false, null, true, true]);
  assert.match(on.line, /a@example\.com\. Next search: tomorrow ~7:00\./);
  assert.match(model({on: true, email: 'a@example.com'}, {state: 'on', next_run_at: tomorrow7, email_channel: 0}, now).line, /E-mail is off for this address/);
});

test('off only after Skip or turning it off, and then the button turns it on', () => {
  const off = model({skipped: true, on: false}, null, now);
  assert.deepEqual([off.state, off.pill[0], off.button, off.off], ['off', 'Off', 'on', false]);
  assert.equal(model({skipped: true, on: true, email: 'a@example.com'}, null, now).state, 'on');   // turned on again since
});

test('paused states say why and what to do: resume after 14 idle days, Get Pro when the trial is over', () => {
  const mine = {on: true, email: 'a@example.com'};
  const idle = model(mine, {state: 'paused', pause_reason: 'inactive'}, now), over = model(mine, {state: 'paused', pause_reason: 'trial-over'}, now);
  assert.deepEqual([idle.pill[0], idle.button], ['Paused', 'resume']);
  assert.match(idle.line, /14 days/);
  assert.deepEqual([over.pill[0], over.button], ['Paused', null]);
  assert.match(over.line, /Get Pro to keep Always on running/);
  assert.match(model(mine, {state: 'paused', pause_reason: 'guard'}, now).line, /this month's limit/);
});

test('when() speaks in the person\'s own day', () => {
  assert.equal(when(new Date(2026, 9, 17, 18, 5).toISOString(), now), 'today ~18:05');
  assert.equal(when(tomorrow7, now), 'tomorrow ~7:00');
  assert.equal(when('nonsense', now), '');
});

test('one name: "Always on", with the two told apart, and nothing user-visible says daily searches, hosted search or on our servers alone', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.equal(NAME, 'Always on: on our servers');
  const html = read('renderer/index.html');
  assert.match(html, /<h3>Always on: your GitHub<\/h3>/);
  assert.match(html, /<b>Always on: your GitHub<\/b>/);
  const view = read('renderer/pages/hosted.js') + read('renderer/hosted-words.js');
  assert.match(view, /'Turn on Always on'/); assert.match(view, /'Turn off'/); assert.match(view, /'Download my data'/); assert.match(view, /'Resume Always on'/);
  assert.match(view, /el\('li', '', 'Always on'\)/);
  assert.doesNotMatch(view.replace(/\/\/.*$/gm, ''), /[Dd]aily searches|[Hh]osted search|GitHub|container|\$\d/);
});
