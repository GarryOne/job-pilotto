// The sidebar counter ("Free plan · 28 of 40 applications left"): the plan, the words, the bar (what is left, draining) and the tone for
// each situation the allowance can be in.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chip} from '../renderer/license-chip.js';

const state = (extra = {}) => ({licensed: false, ended: false, used: 12, limit: 40, daysLeft: 41, ...extra});

test('while the allowance lasts it names the plan and says how many of the free applications are left, with a bar that drains', () => {
  const shown = chip(state());
  assert.deepEqual([shown.plan, shown.text, shown.tone, shown.percent], ['Free plan', '28 of 40 applications left', 'info', 70]);
  assert.match(shown.title, /Free plan: 12 of 40 applications used · 41 days left/);
  assert.match(shown.title, /whichever comes later/);
  assert.match(shown.title, /license key lifts the limit/);
  assert.equal(chip(state({used: 39})).text, '1 of 40 applications left');
  assert.equal(chip(state({used: 0})).percent, 100);
  assert.equal(chip(state({used: 40, daysLeft: 3})).percent, 2, 'an empty bar still shows');
});

test('the tone turns to a warning only when few are left and the free days are used up', () => {
  assert.equal(chip(state({used: 37, daysLeft: 20})).tone, 'info');       // few left, but days remain: no alarm
  assert.equal(chip(state({used: 37, daysLeft: 0})).tone, 'warn');
  assert.equal(chip(state({used: 45, daysLeft: 3})).text, '0 of 40 applications left');
});

test('past the allowance it says so plainly, and a licensed install shows no counter at all', () => {
  const over = chip(state({ended: true, used: 41, daysLeft: 0}));
  assert.deepEqual([over.plan, over.text, over.tone, over.percent], ['Free plan', 'Free period over', 'warn', 2]);
  assert.match(over.title, /Tracking, Notion and export keep working/);
  assert.equal(chip(state({licensed: true})), null);
  assert.equal(chip(null), null);
});
